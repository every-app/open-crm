import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxConnection, oauthState, user } from "@/db/schema";
import { randomToken } from "@/server/lib/pkce";
import { decryptToken, encryptToken } from "@/server/lib/tokenCrypto";
import {
  grantedSources,
  type MailboxProvider,
  type SyncSource,
} from "@/shared/mailbox";

// A member's mailbox connections and the single-use states of the connects
// they start. Tokens are stored encrypted (server/lib/tokenCrypto.ts) and
// read only by the token service and a disconnect; nothing here hands them to
// a caller that returns them to a client.

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

/**
 * Every member's connections in the organization, with each member's name
 * and email, without their tokens: for its owners and admins.
 */
async function listForOrganization(organizationId: string) {
  const rows = await db
    .select({
      ...connectionColumns,
      name: user.name,
      email: user.email,
    })
    .from(mailboxConnection)
    .innerJoin(user, eq(user.id, mailboxConnection.userId))
    .where(eq(mailboxConnection.organizationId, organizationId))
    .orderBy(user.name, mailboxConnection.provider);
  return rows.map((row) => ({
    ...row,
    hasRefreshToken: Boolean(row.hasRefreshToken),
  }));
}

/**
 * The member's connection to `provider`, without its tokens: what a connect
 * reads, so one still works when the stored tokens can't be decrypted.
 */
async function find(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
) {
  const rows = await listForUser(organizationId, userId);
  return rows.find((row) => row.provider === provider) ?? null;
}

/** The member's connection to `provider`, tokens decrypted (server only). */
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
  if (!row) return null;
  return {
    ...row,
    accessToken: row.accessToken && (await decryptToken(row.accessToken)),
    refreshToken: row.refreshToken && (await decryptToken(row.refreshToken)),
  };
}

/**
 * Whether another member's connection is to the same account at `provider`.
 * Only whether one exists: nothing of it is read.
 */
async function accountConnectedElsewhere(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ found: sql<number>`1` })
    .from(mailboxConnection)
    .where(
      and(
        eq(mailboxConnection.organizationId, input.organizationId),
        eq(mailboxConnection.provider, input.provider),
        eq(mailboxConnection.accountEmail, input.accountEmail),
        ne(mailboxConnection.userId, input.userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

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
  const accessToken = await encryptToken(input.accessToken);
  const refreshToken =
    input.refreshToken && (await encryptToken(input.refreshToken));
  const keep = sql`case when ${mailboxConnection.accountEmail} = ${input.accountEmail} then ${mailboxConnection.refreshToken} else null end`;
  await db
    .insert(mailboxConnection)
    .values({
      ...input,
      accessToken,
      refreshToken,
      id: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .onConflictDoUpdate({
      target: [
        mailboxConnection.organizationId,
        mailboxConnection.userId,
        mailboxConnection.provider,
      ],
      set: {
        accountEmail: input.accountEmail,
        scopes: input.scopes,
        accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshToken: refreshToken ?? keep,
        status: "ACTIVE",
        updatedAt: now,
      },
    });
}

/**
 * Stores a refreshed access token, and the refresh token when the provider
 * rotated it (Microsoft always does), only if the stored refresh token is
 * still the one used: a concurrent refresh that landed first keeps its newer
 * tokens. False when it lost. Encrypted with a fresh IV each time, a token
 * can't be matched in SQL: the update is conditional on the stored value it
 * read, once that decrypts to the token used.
 */
async function storeRefreshed(input: {
  organizationId: string;
  id: string;
  usedRefreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string | null;
}): Promise<boolean> {
  const connection = and(
    eq(mailboxConnection.organizationId, input.organizationId),
    eq(mailboxConnection.id, input.id),
  );
  const [stored] = await db
    .select({ refreshToken: mailboxConnection.refreshToken })
    .from(mailboxConnection)
    .where(connection)
    .limit(1);
  if (
    !stored?.refreshToken ||
    (await decryptToken(stored.refreshToken)) !== input.usedRefreshToken
  ) {
    return false;
  }
  const rows = await db
    .update(mailboxConnection)
    .set({
      accessToken: await encryptToken(input.accessToken),
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshToken: await encryptToken(
        input.refreshToken ?? input.usedRefreshToken,
      ),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(connection, eq(mailboxConnection.refreshToken, stored.refreshToken)),
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

/** The sources any member of the organization has connected. */
async function connectedSources(
  organizationId: string,
): Promise<Set<SyncSource>> {
  const rows = await db
    .select({
      provider: mailboxConnection.provider,
      scopes: mailboxConnection.scopes,
    })
    .from(mailboxConnection)
    .where(eq(mailboxConnection.organizationId, organizationId));
  return new Set(
    rows.flatMap((row) => grantedSources(row.provider, row.scopes)),
  );
}

export const ConnectionRepository = {
  createState,
  consumeState,
  listForUser,
  find,
  listForOrganization,
  findWithTokens,
  accountConnectedElsewhere,
  upsert,
  storeRefreshed,
  expireAccessToken,
  markNeedsReconnect,
  remove,
  accountEmails,
  connectedSources,
};
