import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  trackedEvent,
  trackedPageDaily,
  trackedVisitor,
  trackingCounter,
} from "@/db/schema";

// Website tracking's retention, across every organization at once (the
// cron's sweep). Nothing here is read back by an organization; each
// statement is bounded by `limit`.

/** The oldest `limit` events before `cutoff`, always the same ones. */
function oldest(executor: typeof db, cutoff: string, limit: number) {
  return executor
    .select({ id: trackedEvent.id })
    .from(trackedEvent)
    .where(lt(trackedEvent.occurredAt, cutoff))
    .orderBy(asc(trackedEvent.occurredAt), asc(trackedEvent.id))
    .limit(limit);
}

/**
 * Rolls the page views among the oldest `limit` events before `cutoff` into
 * daily rows per page, and deletes those events, in one atomic batch: each
 * event is counted once, in the batch that deletes it. How many went.
 * Visitors are added up per batch, so one whose views of a page fall in two
 * batches of a day counts twice.
 */
async function rollUpAndDeleteBefore(cutoff: string, limit: number) {
  const [batch] = await db
    .select({ size: count() })
    .from(oldest(db, cutoff, limit).as("oldest"));
  const size = batch?.size ?? 0;
  if (size === 0) return 0;
  const day = sql<string>`substr(${trackedEvent.occurredAt}, 1, 10)`;
  await runBatch((tx) => [
    tx
      .insert(trackedPageDaily)
      .select(
        tx
          .select({
            organizationId: trackedEvent.organizationId,
            day: sql<string>`${day}`.as("day"),
            host: trackedEvent.host,
            path: trackedEvent.path,
            views: sql<number>`count(*)`.as("views"),
            visitors: sql<number>`count(distinct ${trackedEvent.visitorId})`.as(
              "visitors",
            ),
          })
          .from(trackedEvent)
          .where(
            and(
              inArray(trackedEvent.id, oldest(tx, cutoff, limit)),
              eq(trackedEvent.type, "page_view"),
            ),
          )
          .groupBy(
            trackedEvent.organizationId,
            day,
            trackedEvent.host,
            trackedEvent.path,
          ),
      )
      .onConflictDoUpdate({
        target: [
          trackedPageDaily.organizationId,
          trackedPageDaily.day,
          trackedPageDaily.host,
          trackedPageDaily.path,
        ],
        set: {
          views: sql`${trackedPageDaily.views} + excluded.views`,
          visitors: sql`${trackedPageDaily.visitors} + excluded.visitors`,
        },
      }),
    tx
      .delete(trackedEvent)
      .where(inArray(trackedEvent.id, oldest(tx, cutoff, limit))),
  ]);
  return size;
}

/**
 * Visitors no contact points at any more (theirs was deleted) and with no
 * events left to show; up to `limit` of them.
 */
async function deleteOrphanVisitors(cutoff: string, limit: number) {
  const orphans = db
    .select({
      organizationId: trackedVisitor.organizationId,
      id: trackedVisitor.id,
    })
    .from(trackedVisitor)
    .where(
      and(
        isNull(trackedVisitor.contactId),
        lt(trackedVisitor.lastSeen, cutoff),
        sql`not exists (select 1 from ${trackedEvent} where ${trackedEvent.organizationId} = ${trackedVisitor.organizationId} and ${trackedEvent.visitorId} = ${trackedVisitor.id})`,
      ),
    )
    .limit(limit);
  const removed = await db
    .delete(trackedVisitor)
    .where(
      sql`(${trackedVisitor.organizationId}, ${trackedVisitor.id}) in (${orphans})`,
    )
    .returning({ id: trackedVisitor.id });
  return removed.length;
}

/** Deletes up to `limit` counters whose window has passed. */
async function deleteExpiredCounters(now: string, limit: number) {
  const expired = db
    .select({
      organizationId: trackingCounter.organizationId,
      key: trackingCounter.key,
    })
    .from(trackingCounter)
    .where(lt(trackingCounter.expiresAt, now))
    .limit(limit);
  const removed = await db
    .delete(trackingCounter)
    .where(
      sql`(${trackingCounter.organizationId}, ${trackingCounter.key}) in (${expired})`,
    )
    .returning({ key: trackingCounter.key });
  return removed.length;
}

export const TrackingRetentionRepository = {
  rollUpAndDeleteBefore,
  deleteOrphanVisitors,
  deleteExpiredCounters,
};
