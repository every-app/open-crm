import { tokenRequest } from "@/server/features/mailbox/providers/oauth";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import type { MailboxProvider } from "@/shared/mailbox";

// A member's access token for their mailbox, refreshed through the gateway
// when it is about to expire, ported from the CRM's MailboxTokenService. The
// newest refresh token always wins (Microsoft rotates them on every
// refresh). A refused refresh (`invalid_grant`) marks the connection for
// reconnecting. Tokens go to the provider and nowhere else.

export type TokenResult =
  | { outcome: "ok"; accessToken: string; accountEmail: string }
  | { outcome: "not-connected" }
  | { outcome: "needs-reconnect"; reason: string }
  | { outcome: "failed"; reason: string };

const LABEL = { google: "Google", microsoft: "Microsoft" } as const;

// Refresh a token this close to its expiry rather than send one that dies
// on the way.
const EXPIRY_SKEW_MS = 60_000;

function fresh(
  token: string | null,
  expiresAt: string | null,
): token is string {
  return (
    Boolean(token) &&
    expiresAt !== null &&
    Date.parse(expiresAt) - Date.now() > EXPIRY_SKEW_MS
  );
}

async function accessTokenFor(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
): Promise<TokenResult> {
  const connection = await ConnectionRepository.findWithTokens(
    organizationId,
    userId,
    provider,
  );
  if (!connection) return { outcome: "not-connected" };
  const { accountEmail } = connection;
  if (connection.status === "NEEDS_RECONNECT") {
    return {
      outcome: "needs-reconnect",
      reason: `${LABEL[provider]} needs reconnecting.`,
    };
  }
  if (fresh(connection.accessToken, connection.accessTokenExpiresAt)) {
    return { outcome: "ok", accessToken: connection.accessToken, accountEmail };
  }
  const usedRefreshToken = connection.refreshToken;
  if (!usedRefreshToken) {
    await ConnectionRepository.markNeedsReconnect(
      organizationId,
      connection.id,
    );
    return {
      outcome: "needs-reconnect",
      reason: `${LABEL[provider]} gave no refresh token. Connect again.`,
    };
  }

  const refreshed = await tokenRequest(provider, {
    grant_type: "refresh_token",
    refresh_token: usedRefreshToken,
  });
  if (!refreshed.ok) {
    if (refreshed.kind === "invalid_grant") {
      await ConnectionRepository.markNeedsReconnect(
        organizationId,
        connection.id,
      );
      console.warn("[mailbox] refresh refused: needs reconnecting", {
        organizationId,
        userId,
        provider,
      });
      return {
        outcome: "needs-reconnect",
        reason: `${LABEL[provider]} would not refresh the access token: ${refreshed.reason}`,
      };
    }
    return { outcome: "failed", reason: refreshed.reason };
  }

  const stored = await ConnectionRepository.storeRefreshed({
    organizationId,
    id: connection.id,
    usedRefreshToken,
    accessToken: refreshed.tokens.accessToken,
    accessTokenExpiresAt: refreshed.tokens.accessTokenExpiresAt,
    refreshToken: refreshed.tokens.refreshToken,
  });
  if (stored) {
    return {
      outcome: "ok",
      accessToken: refreshed.tokens.accessToken,
      accountEmail,
    };
  }
  // Another refresh (or a reconnect) stored newer tokens first: use theirs.
  const latest = await ConnectionRepository.findWithTokens(
    organizationId,
    userId,
    provider,
  );
  if (latest && fresh(latest.accessToken, latest.accessTokenExpiresAt)) {
    return {
      outcome: "ok",
      accessToken: latest.accessToken,
      accountEmail: latest.accountEmail,
    };
  }
  return {
    outcome: "failed",
    reason: `${LABEL[provider]}'s tokens changed during the refresh; the next check retries.`,
  };
}

export const TokenService = { accessTokenFor };
