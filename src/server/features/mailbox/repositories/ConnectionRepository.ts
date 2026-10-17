import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxConnection, oauthState } from "@/db/schema";
import { randomToken } from "@/server/lib/pkce";
import type { MailboxProvider } from "@/shared/mailbox";

// A member's mailbox connections and the single-use states of the connects
// they start. Tokens are read only by the token service; nothing here hands
// them to a caller that returns them to a client.

/** A pending connect's state, valid for `ttlMs`; abandoned ones are swept. */
async function createState(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  codeVerifier: string;
  ttlMs: number;
}): Promise<string> {
  const id = randomToken();
  const now = new Date();
  await db
    .delete(oauthState)
    .where(
      and(
        eq(oauthState.organizationId, input.organizationId),
        lt(oauthState.expiresAt, now.toISOString()),
      ),
    );
  await db.insert(oauthState).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    provider: input.provider,
    codeVerifier: input.codeVerifier,
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  });
  return id;
}

/**
 * Consumes the member's unexpired, unused state for `provider` and returns
 * its PKCE verifier; null when it is unknown, someone else's, expired or
 * already used. One conditional update, so two callbacks racing on one
 * state have one winner.
 */
async function consumeState(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  state: string;
}): Promise<{ codeVerifier: string } | null> {
  const now = new Date().toISOString();
  const [row] = await db
    .update(oauthState)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthState.organizationId, input.organizationId),
        eq(oauthState.id, input.state),
        eq(oauthState.userId, input.userId),
        eq(oauthState.provider, input.provider),
        isNull(oauthState.consumedAt),
        gt(oauthState.expiresAt, now),
      ),
    )
    .returning({ codeVerifier: oauthState.codeVerifier });
  return row ?? null;
}

const connectionColumns = {
  id: mailboxConnection.id,
  organizationId: mailboxConnection.organizationId,
  userId: mailboxConnection.userId,
  provider: mailboxConnection.provider,
  accountEmail: mailboxConnection.accountEmail,
  scopes: mailboxConnection.scopes,
  status: mailboxConnection.status,
  hasRefreshToken: sql<boolean>`(${mailboxConnection.refreshToken} is not null)`,
  updatedAt: mailboxConnection.updatedAt,
};

/** The member's connections, without their tokens. */
async function listForUser(organizationId: string, userId: string) {
  const rows = await db
    .select(connectionColumns)
    .from(mailboxConnection)
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.userId, userId),
      ),
    );
  // SQLite answers the comparison as 0 or 1.
  return rows.map((row) => ({
    ...row,
    hasRefreshToken: Boolean(row.hasRefreshToken),
  }));
}

/** The member's connection to `provider`, tokens included (server only). */
async function findWithTokens(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
) {
  const [row] = await db
    .select()
    .from(mailboxConnection)
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.userId, userId),
        eq(mailboxConnection.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type ConnectionWithTokens = NonNullable<
  Awaited<ReturnType<typeof findWithTokens>>
>;

/**
 * Stores the member's connection, one per provider. Google omits the
 * refresh token when the member had already consented: the stored one is
 * kept then, unless the member connected a different account.
 */
async function upsert(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
  scopes: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string | null;
}) {
  const now = new Date().toISOString();
  const keep = sql`case when ${mailboxConnection.accountEmail} = ${input.accountEmail} then ${mailboxConnection.refreshToken} else null end`;
  await db
    .insert(mailboxConnection)
    .values({ ...input, id: crypto.randomUUID(), status: "ACTIVE" })
    .onConflictDoUpdate({
      target: [
        mailboxConnection.organizationId,
        mailboxConnection.userId,
        mailboxConnection.provider,
      ],
      set: {
        accountEmail: input.accountEmail,
        scopes: input.scopes,
        accessToken: input.accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshToken: input.refreshToken ?? keep,
        status: "ACTIVE",
        updatedAt: now,
      },
    });
}

/**
 * Stores a refreshed access token, and the refresh token when the provider
 * rotated it (Microsoft always does), only if the stored refresh token is
 * still the one used: a concurrent refresh that landed first keeps its newer
 * tokens. False when it lost.
 */
async function storeRefreshed(input: {
  organizationId: string;
  id: string;
  usedRefreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string | null;
}): Promise<boolean> {
  const rows = await db
    .update(mailboxConnection)
    .set({
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshToken: input.refreshToken ?? input.usedRefreshToken,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(mailboxConnection.organizationId, input.organizationId),
        eq(mailboxConnection.id, input.id),
        eq(mailboxConnection.refreshToken, input.usedRefreshToken),
      ),
    )
    .returning({ id: mailboxConnection.id });
  return rows.length > 0;
}

/** Forgets the access token so the next call refreshes it. */
async function expireAccessToken(organizationId: string, id: string) {
  await db
    .update(mailboxConnection)
    .set({ accessTokenExpiresAt: new Date(0).toISOString() })
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.id, id),
      ),
    );
}

/** The provider refused the grant: the member has to connect again. */
async function markNeedsReconnect(organizationId: string, id: string) {
  await db
    .update(mailboxConnection)
    .set({
      status: "NEEDS_RECONNECT",
      accessToken: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.id, id),
      ),
    );
}

async function remove(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
) {
  await db
    .delete(mailboxConnection)
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.userId, userId),
        eq(mailboxConnection.provider, provider),
      ),
    );
}

/** Every mailbox the organization's members connected: their addresses are ours. */
async function accountEmails(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ email: mailboxConnection.accountEmail })
    .from(mailboxConnection)
    .where(eq(mailboxConnection.organizationId, organizationId));
  return rows.map((row) => row.email);
}

export const ConnectionRepository = {
  createState,
  consumeState,
  listForUser,
  findWithTokens,
  upsert,
  storeRefreshed,
  expireAccessToken,
  markNeedsReconnect,
  remove,
  accountEmails,
};
