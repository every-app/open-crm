import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mailboxConnection, user } from "@/db/schema";
import type { MailboxProvider } from "@/shared/mailbox";

// A member's mailbox connections: which mailbox each reads and whether it
// needs connecting again. The tokens are the Every App gateway's; the CRM
// never holds one.

const connectionColumns = {
  id: mailboxConnection.id,
  organizationId: mailboxConnection.organizationId,
  userId: mailboxConnection.userId,
  provider: mailboxConnection.provider,
  accountEmail: mailboxConnection.accountEmail,
  scopes: mailboxConnection.scopes,
  status: mailboxConnection.status,
  updatedAt: mailboxConnection.updatedAt,
};

/** The member's connections. */
async function listForUser(organizationId: string, userId: string) {
  return db
    .select(connectionColumns)
    .from(mailboxConnection)
    .where(
      and(
        eq(mailboxConnection.organizationId, organizationId),
        eq(mailboxConnection.userId, userId),
      ),
    );
}

/**
 * Every member's connections in the organization, with each member's name
 * and email: for its owners and admins.
 */
async function listForOrganization(organizationId: string) {
  return db
    .select({
      ...connectionColumns,
      name: user.name,
      email: user.email,
    })
    .from(mailboxConnection)
    .innerJoin(user, eq(user.id, mailboxConnection.userId))
    .where(eq(mailboxConnection.organizationId, organizationId))
    .orderBy(user.name, mailboxConnection.provider);
}

/** The member's connection to `provider`. */
async function find(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
) {
  const rows = await listForUser(organizationId, userId);
  return rows.find((row) => row.provider === provider) ?? null;
}

/** Stores the member's connection, one per provider, as ACTIVE. */
async function upsert(input: {
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
  scopes: string;
}) {
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
        status: "ACTIVE",
        updatedAt: new Date().toISOString(),
      },
    });
}

/** The gateway holds no usable connection: the member connects again. */
async function markNeedsReconnect(organizationId: string, id: string) {
  await db
    .update(mailboxConnection)
    .set({
      status: "NEEDS_RECONNECT",
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
  listForUser,
  find,
  listForOrganization,
  upsert,
  markNeedsReconnect,
  remove,
  accountEmails,
};
