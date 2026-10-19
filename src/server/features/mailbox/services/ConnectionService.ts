import { ArchiveRepository } from "@/server/features/archive/repositories/ArchiveRepository";
import { primaryCalendar } from "@/server/features/mailbox/providers/calendar";
import { gmailProfile } from "@/server/features/mailbox/providers/gmail";
import { graphMe } from "@/server/features/mailbox/providers/outlook";
import {
  AUTHORIZE_URL,
  CALLBACK_PATH,
  GATEWAY_SECRETS,
  clientStatus,
  revokeGoogleToken,
  tokenRequest,
} from "@/server/features/mailbox/providers/oauth";
import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import { SyncedDataRepository } from "@/server/features/mailbox/repositories/SyncedDataRepository";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SyncStateRepository } from "@/server/features/mailbox/repositories/SyncStateRepository";
import { MailboxSyncService } from "@/server/features/mailbox/services/MailboxSyncService";
import { MatchService } from "@/server/features/mailbox/services/MatchService";
import { deploymentTierFor } from "@/server/lib/deployment-tier";
import { AppError } from "@/server/lib/errors";
import { codeChallenge, randomToken } from "@/server/lib/pkce";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { requireTokenKey } from "@/server/lib/tokenCrypto";
import { normalizeDomain } from "@/shared/domain";
import {
  grantedSources,
  MAILBOX_PROVIDERS,
  REQUESTED_SCOPES,
  SOURCES_BY_PROVIDER,
  type ConnectError,
  type MailboxProvider,
  type SyncSource,
} from "@/shared/mailbox";
import { hasOrgPermission } from "@/shared/org-permissions";

// A member's own mailbox connections, ported from the CRM's
// google-connection.service.ts and microsoft-connection.service.ts and its
// Better Auth link flow. Connect: an authorize URL with a single-use state
// (ten minutes, bound to the member and organization) and PKCE; the callback
// checks the state is the member's, exchanges the code through the gateway,
// learns the mailbox's address, refuses one that isn't the address the
// member signs in with, stores the member's tokens and starts the sources
// the member granted. Everything here is the member's own, but suppressing a
// domain, which is the organization's.

type Member = { organizationId: string; userId: string };

const STATE_TTL_MS = 10 * 60_000;

const LABEL = { google: "Google", microsoft: "Microsoft" } as const;

function redirectUri(origin: string, provider: MailboxProvider): string {
  return `${origin}${CALLBACK_PATH[provider]}`;
}

/** The provider's authorize URL for the member, with a fresh state. */
async function startConnect(
  member: Member,
  provider: MailboxProvider,
  origin: string,
): Promise<{ url: string }> {
  const client = await clientStatus(provider);
  if (!client.ready || !client.clientId) {
    throw new AppError(
      "INTEGRATION_UNAVAILABLE",
      `${LABEL[provider]} isn't set up on this Every App gateway.`,
    );
  }
  // Its tokens are stored encrypted: no key, no consent screen to sit through.
  await requireTokenKey();
  const codeVerifier = randomToken();
  const state = await ConnectionRepository.createState({
    ...member,
    provider,
    codeVerifier,
    ttlMs: STATE_TTL_MS,
  });
  const url = new URL(AUTHORIZE_URL[provider]);
  const params = url.searchParams;
  params.set("client_id", client.clientId);
  params.set("redirect_uri", redirectUri(origin, provider));
  params.set("response_type", "code");
  params.set("scope", REQUESTED_SCOPES[provider].join(" "));
  params.set("state", state);
  params.set("code_challenge", await codeChallenge(codeVerifier));
  params.set("code_challenge_method", "S256");
  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("include_granted_scopes", "true");
    // Google only sends a refresh token with a consent screen: ask for one
    // unless the member's connection already holds one.
    const existing = await ConnectionRepository.find(
      member.organizationId,
      member.userId,
      provider,
    );
    if (!existing?.hasRefreshToken) params.set("prompt", "consent");
  } else {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }
  return { url: url.toString() };
}

type CallbackOutcome = { ok: true } | { ok: false; error: ConnectError };

/**
 * The provider sent the member back to `callbackUrl`. Consumes the state
 * first, so a state presented twice, or by someone else, is refused.
 */
async function completeConnect(
  member: Member & { userEmail: string },
  provider: MailboxProvider,
  callbackUrl: URL,
): Promise<CallbackOutcome> {
  const query = callbackUrl.searchParams;
  const state = query.get("state");
  const consumed = state
    ? await ConnectionRepository.consumeState({ ...member, provider, state })
    : null;
  if (!consumed) return { ok: false, error: "state_mismatch" };

  const providerError = query.get("error");
  if (providerError) {
    return {
      ok: false,
      error:
        providerError === "access_denied" ? "access_denied" : "exchange_failed",
    };
  }
  const code = query.get("code");
  if (!code) return { ok: false, error: "exchange_failed" };

  const exchanged = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(callbackUrl.origin, provider),
    code_verifier: consumed.codeVerifier,
  });
  if (!exchanged.ok) {
    console.warn("[mailbox] code exchange failed", {
      organizationId: member.organizationId,
      provider,
      reason: exchanged.reason,
    });
    return { ok: false, error: "exchange_failed" };
  }
  const { tokens } = exchanged;
  // Google returns the scopes granted (a member may untick one); an omitted
  // scope means all of them.
  const scopes = tokens.scope ?? REQUESTED_SCOPES[provider].join(" ");
  const sources = grantedSources(provider, scopes);
  if (sources.length === 0) return { ok: false, error: "scope_not_granted" };

  const accountEmail = await mailboxAddress(
    provider,
    tokens.accessToken,
    sources,
  );
  if (!accountEmail) return { ok: false, error: "mailbox_unknown" };
  // The member's own mailbox only, as the CRM's account linking allowed: the
  // address they sign in with, in any case.
  if (accountEmail !== member.userEmail.toLowerCase()) {
    return { ok: false, error: "email_doesn't_match" };
  }

  const previous = await ConnectionRepository.find(
    member.organizationId,
    member.userId,
    provider,
  );
  await ConnectionRepository.upsert({
    ...member,
    provider,
    accountEmail,
    scopes,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken,
  });
  await SyncStateRepository.ensureSources({
    ...member,
    sources,
    // A different mailbox than before starts from now.
    resetCursor: Boolean(previous && previous.accountEmail !== accountEmail),
  });
  await SyncStateRepository.removeSources(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider].filter((source) => !sources.includes(source)),
  );
  console.log("[mailbox] connected", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
    sources,
  });
  return { ok: true };
}

/** The connected mailbox's address, lowercased; null when the provider won't say. */
async function mailboxAddress(
  provider: MailboxProvider,
  accessToken: string,
  sources: SyncSource[],
): Promise<string | null> {
  const budget = { calls: 2, deadline: Date.now() + 20_000 };
  if (provider === "microsoft") {
    const me = await graphMe(accessToken, budget);
    if (me.outcome !== "ok") return null;
    return (me.data.mail ?? me.data.userPrincipalName)?.toLowerCase() ?? null;
  }
  if (sources.includes("gmail")) {
    const profile = await gmailProfile(accessToken, budget);
    return profile.outcome === "ok"
      ? (profile.data.emailAddress?.toLowerCase() ?? null)
      : null;
  }
  const calendar = await primaryCalendar(accessToken, budget);
  return calendar.outcome === "ok"
    ? (calendar.data.id?.toLowerCase() ?? null)
    : null;
}

/**
 * Settings → Connections for the member: each provider, whether this
 * gateway offers it, and the member's own connection with each source's
 * sync. Owners and admins of a fork also get what to set on the gateway.
 */
async function status(member: Member & { role: string }, origin: string) {
  const [connections, rows, clients] = await Promise.all([
    ConnectionRepository.listForUser(member.organizationId, member.userId),
    SyncStateRepository.listForUser(member.organizationId, member.userId),
    Promise.all(MAILBOX_PROVIDERS.map((provider) => clientStatus(provider))),
  ]);
  const now = new Date().toISOString();
  const env = (await getWorkersEnv()) ?? {};
  // `everyapp dev` has no gateway: the developer's own client goes in
  // .dev.vars under the gateway's names.
  const local = Boolean((env as { EVERYAPP_DEV?: string }).EVERYAPP_DEV);
  // Only a fork's own gateway holds clients its people set up; the hosted
  // CRM's are Every App's.
  const showSetup =
    deploymentTierFor(env) === "fork" &&
    (local || hasOrgPermission(member.role, { workspace: ["manage"] }));

  const providers = MAILBOX_PROVIDERS.map((provider, index) => {
    const connection = connections.find((row) => row.provider === provider);
    const granted = new Set(grantedSources(provider, connection?.scopes));
    return {
      provider,
      ready: clients[index]?.ready ?? false,
      setup: showSetup
        ? {
            command: local
              ? null
              : `pnpm everyapp secret set ${GATEWAY_SECRETS[provider].join(" ")} --for gateway`,
            devVars: local ? [...GATEWAY_SECRETS[provider]] : null,
            redirectUri: redirectUri(origin, provider),
          }
        : null,
      connection: connection
        ? {
            accountEmail: connection.accountEmail,
            needsReconnect: connection.status === "NEEDS_RECONNECT",
            hasRefreshToken: connection.hasRefreshToken,
            sources: SOURCES_BY_PROVIDER[provider].map((source) => {
              const row = rows.find((candidate) => candidate.source === source);
              return {
                source,
                granted: granted.has(source),
                status: row?.status ?? null,
                syncing:
                  row?.status === "RUNNING" &&
                  row.leaseUntil !== null &&
                  row.leaseUntil > now,
                lastSyncedAt: row?.lastSyncedAt ?? null,
                lastError: row?.lastError ?? null,
                autoCreate: row?.autoCreate ?? false,
              };
            }),
          }
        : null,
    };
  });
  return { providers };
}

export type ConnectionsStatus = Awaited<ReturnType<typeof status>>;

async function setAutoCreate(
  member: Member,
  source: SyncSource,
  enabled: boolean,
): Promise<void> {
  const changed = await SyncStateRepository.setAutoCreate({
    ...member,
    source,
    enabled,
  });
  if (!changed) throw new AppError("NOT_FOUND", `${source} isn't connected.`);
}

/** Checks the member's sources of `provider` now. */
async function checkNow(member: Member, provider: MailboxProvider) {
  await MailboxSyncService.checkNow(
    member.organizationId,
    member.userId,
    provider,
  );
}

/**
 * "Check now" for an AI client, whose call can't outlast a check: makes the
 * member's sources of `provider` due for the minute cron's next sweep.
 */
async function queueCheck(
  member: Member,
  provider: MailboxProvider,
): Promise<{ sources: SyncSource[] }> {
  const due = await SyncStateRepository.markDue(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider],
  );
  const sources = SOURCES_BY_PROVIDER[provider].filter((source) =>
    due.includes(source),
  );
  if (sources.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      `${LABEL[provider]} isn't connected, or needs reconnecting in Settings → Connections.`,
    );
  }
  return { sources };
}

/**
 * Deletes everything the member's mailbox brought in from `provider`. The
 * sources keep their cursors, so nothing deleted comes back.
 */
async function purgeSynced(
  member: Member,
  provider: MailboxProvider,
): Promise<{ purged: number }> {
  const { purged, targets } = await SyncedDataRepository.purgeSynced(
    member.organizationId,
    member.userId,
    provider,
  );
  await ArchiveRepository.restamp(member.organizationId, targets);
  console.log("[mailbox] synced data deleted", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
    purged,
  });
  return { purged };
}

/**
 * "Not a customer", ported from the CRM's suppressDomain: the domain's people
 * never become contacts on their own again, from mail, meetings or website
 * forms. With `purge`, the threads and meetings already filed on its company
 * go too. Our own domains are refused: they are excluded already.
 */
async function suppressDomain(
  organizationId: string,
  input: { domain: string; reason?: string; purge: boolean },
): Promise<{ domain: string; purged: number }> {
  const domain = normalizeDomain(input.domain);
  if (!domain) {
    throw new AppError("NOT_FOUND", `"${input.domain}" is not a domain.`);
  }
  const { ourDomains } = await MatchService.internalIdentity(organizationId);
  if (ourDomains.has(domain)) {
    throw new AppError(
      "NOT_FOUND",
      "That is our own domain — it is already excluded.",
    );
  }
  await CaptureWriteRepository.suppressDomain(
    organizationId,
    domain,
    input.reason ?? null,
  );
  if (!input.purge) return { domain, purged: 0 };

  const { purged, targets } = await SyncedDataRepository.purgeDomain(
    organizationId,
    domain,
  );
  await ArchiveRepository.restamp(organizationId, targets);
  console.log("[mailbox] domain suppressed", {
    organizationId,
    domain,
    purged,
  });
  return { domain, purged };
}

/**
 * Stops capture and forgets the member's tokens; what was captured stays.
 * Google's grant is withdrawn at Google first (refusing to forget a grant
 * Google still honours), unless another connection uses that Google account:
 * withdrawing a token ends the account's whole grant to the gateway's client,
 * which every organization shares, so it would end theirs too. Microsoft has
 * no way to withdraw consent from here, which the page tells the member.
 */
async function disconnect(member: Member, provider: MailboxProvider) {
  const connection = await ConnectionRepository.findWithTokens(
    member.organizationId,
    member.userId,
    provider,
  );
  if (!connection) return;
  const token = connection.refreshToken ?? connection.accessToken;
  if (
    provider === "google" &&
    token &&
    !(await ConnectionRepository.accountConnectedElsewhere({
      ...member,
      provider,
      accountEmail: connection.accountEmail,
    })) &&
    !(await revokeGoogleToken(token))
  ) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Google did not confirm the access was withdrawn.",
    );
  }
  await SyncStateRepository.removeSources(
    member.organizationId,
    member.userId,
    SOURCES_BY_PROVIDER[provider],
  );
  await ConnectionRepository.remove(
    member.organizationId,
    member.userId,
    provider,
  );
  console.log("[mailbox] disconnected", {
    organizationId: member.organizationId,
    userId: member.userId,
    provider,
  });
}

export const ConnectionService = {
  startConnect,
  completeConnect,
  status,
  setAutoCreate,
  checkNow,
  queueCheck,
  purgeSynced,
  suppressDomain,
  disconnect,
};
