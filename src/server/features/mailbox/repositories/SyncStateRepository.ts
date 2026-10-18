import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxSync } from "@/db/schema";
import {
  AUTO_CREATE_DEFAULT,
  type SyncSource,
  type SyncStatus,
} from "@/shared/mailbox";

// Each member's sync of each source (`mailbox_sync`), ported from the CRM's
// SyncStateService. A row is due when `next_sync_at` has passed and no check
// holds its lease; a check claims it with a conditional update, so two crons
// (or a cron and "Check now") never run one mailbox at once, and a check that
// dies lets go when its lease runs out.

/** How often each mailbox is checked. */
const SYNC_INTERVAL_MS = 5 * 60_000;
/** How long a check holds its row: well past the longest a check runs. */
const SYNC_LEASE_MS = 10 * 60_000;

export type SyncRow = typeof mailboxSync.$inferSelect;

function later(ms: number, from = Date.now()): string {
  return new Date(from + ms).toISOString();
}

function inOrganization(organizationId: string, id: string) {
  return and(
    eq(mailboxSync.organizationId, organizationId),
    eq(mailboxSync.id, id),
  );
}

/**
 * Creates the member's rows for newly granted sources, with the CRM's
 * auto-create defaults, and makes every listed source due now: a reconnect
 * clears the error and lifts NEEDS_RECONNECT. `resetCursor` starts them
 * from now (a different account was connected).
 */
async function ensureSources(input: {
  organizationId: string;
  userId: string;
  sources: readonly SyncSource[];
  resetCursor: boolean;
}) {
  const now = new Date().toISOString();
  for (const source of input.sources) {
    await db
      .insert(mailboxSync)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        source,
        status: "IDLE",
        autoCreate: AUTO_CREATE_DEFAULT[source],
        nextSyncAt: now,
      })
      .onConflictDoUpdate({
        target: [
          mailboxSync.organizationId,
          mailboxSync.userId,
          mailboxSync.source,
        ],
        set: {
          status: "IDLE",
          lastError: null,
          nextSyncAt: now,
          leaseUntil: null,
          ...(input.resetCursor ? { cursor: null } : {}),
          updatedAt: now,
        },
      });
  }
}

/** Stops syncing the member's `sources` (their captured data stays). */
async function removeSources(
  organizationId: string,
  userId: string,
  sources: readonly SyncSource[],
) {
  if (sources.length === 0) return;
  await db
    .delete(mailboxSync)
    .where(
      and(
        eq(mailboxSync.organizationId, organizationId),
        eq(mailboxSync.userId, userId),
        inArray(mailboxSync.source, [...sources]),
      ),
    );
}

async function listForUser(organizationId: string, userId: string) {
  return db
    .select()
    .from(mailboxSync)
    .where(
      and(
        eq(mailboxSync.organizationId, organizationId),
        eq(mailboxSync.userId, userId),
      ),
    );
}

function dueCondition(now: string) {
  return and(
    lte(mailboxSync.nextSyncAt, now),
    or(isNull(mailboxSync.leaseUntil), lte(mailboxSync.leaseUntil, now)),
  );
}

/**
 * The rows due now across every organization, of `sources`, the longest
 * waiting first: the minute cron's one query (mailbox_sync_next_idx).
 */
async function due(input: {
  now: string;
  sources: readonly SyncSource[];
  limit: number;
}) {
  if (input.sources.length === 0) return [];
  return db
    .select()
    .from(mailboxSync)
    .where(
      and(
        dueCondition(input.now),
        inArray(mailboxSync.source, [...input.sources]),
      ),
    )
    .orderBy(asc(mailboxSync.nextSyncAt))
    .limit(input.limit);
}

/**
 * Takes the row's lease: the row as claimed, or null when another check
 * holds it, it isn't due (unless `force`, a member's "Check now"), or the
 * member must reconnect.
 */
async function claim(input: {
  organizationId: string;
  id: string;
  force?: boolean;
}): Promise<SyncRow | null> {
  const now = new Date().toISOString();
  const [row] = await db
    .update(mailboxSync)
    .set({
      status: "RUNNING",
      leaseUntil: later(SYNC_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        inOrganization(input.organizationId, input.id),
        sql`${mailboxSync.status} <> 'NEEDS_RECONNECT'`,
        input.force
          ? or(isNull(mailboxSync.leaseUntil), lte(mailboxSync.leaseUntil, now))
          : dueCondition(now),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * How a check ended. `cursor`, when given, is how far it got (null starts
 * the source again from now); left out, the cursor stays.
 */
export type Settlement = { cursor?: string | null } & (
  | { status: "IDLE" }
  | { status: "FAILED"; reason: string }
  | { status: "RATE_LIMITED"; reason: string; retryAfterMs: number }
  | { status: "NEEDS_RECONNECT"; reason: string }
);

/**
 * Lets go of the lease with the check's outcome: a finished check records
 * when it ran (and its cursor) and is due again in five minutes; a failure
 * keeps its error and retries then; a rate limit waits as long as the
 * provider asked; a refused grant waits for the member to reconnect.
 */
async function settle(organizationId: string, id: string, outcome: Settlement) {
  const now = new Date();
  const at = now.toISOString();
  const common = {
    leaseUntil: null,
    updatedAt: at,
    ...(outcome.cursor === undefined ? {} : { cursor: outcome.cursor }),
  };
  const set = ((): Partial<SyncRow> => {
    switch (outcome.status) {
      case "IDLE":
        return {
          status: "IDLE",
          lastSyncedAt: at,
          lastError: null,
          nextSyncAt: later(SYNC_INTERVAL_MS, now.getTime()),
        };
      case "FAILED":
        return {
          status: "FAILED",
          lastError: outcome.reason,
          nextSyncAt: later(SYNC_INTERVAL_MS, now.getTime()),
        };
      case "RATE_LIMITED":
        return {
          status: "IDLE",
          nextSyncAt: later(outcome.retryAfterMs, now.getTime()),
        };
      case "NEEDS_RECONNECT":
        return {
          status: "NEEDS_RECONNECT",
          lastError: outcome.reason,
          nextSyncAt: null,
        };
    }
  })();
  await db
    .update(mailboxSync)
    .set({ ...set, ...common })
    .where(inOrganization(organizationId, id));
}

/** The provider refused the member's grant: every source of it waits. */
async function needReconnect(
  organizationId: string,
  userId: string,
  sources: readonly SyncSource[],
  reason: string,
) {
  await db
    .update(mailboxSync)
    .set({
      status: "NEEDS_RECONNECT" satisfies SyncStatus,
      lastError: reason,
      nextSyncAt: null,
      leaseUntil: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(mailboxSync.organizationId, organizationId),
        eq(mailboxSync.userId, userId),
        inArray(mailboxSync.source, [...sources]),
      ),
    );
}

/**
 * Makes the member's `sources` due now, for the minute cron's next sweep:
 * an AI client's "Check now", which can't wait out a check. One waiting for
 * a reconnect stays waiting. The sources made due.
 */
async function markDue(
  organizationId: string,
  userId: string,
  sources: readonly SyncSource[],
): Promise<SyncSource[]> {
  const now = new Date().toISOString();
  const rows = await db
    .update(mailboxSync)
    .set({ nextSyncAt: now, updatedAt: now })
    .where(
      and(
        eq(mailboxSync.organizationId, organizationId),
        eq(mailboxSync.userId, userId),
        inArray(mailboxSync.source, [...sources]),
        sql`${mailboxSync.status} <> 'NEEDS_RECONNECT'`,
      ),
    )
    .returning({ source: mailboxSync.source });
  return rows.map((row) => row.source);
}

/** False when the member doesn't sync `source`. */
async function setAutoCreate(input: {
  organizationId: string;
  userId: string;
  source: SyncSource;
  enabled: boolean;
}): Promise<boolean> {
  const rows = await db
    .update(mailboxSync)
    .set({ autoCreate: input.enabled, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(mailboxSync.organizationId, input.organizationId),
        eq(mailboxSync.userId, input.userId),
        eq(mailboxSync.source, input.source),
      ),
    )
    .returning({ id: mailboxSync.id });
  return rows.length > 0;
}

export const SyncStateRepository = {
  ensureSources,
  removeSources,
  listForUser,
  due,
  claim,
  settle,
  needReconnect,
  markDue,
  setAutoCreate,
};
