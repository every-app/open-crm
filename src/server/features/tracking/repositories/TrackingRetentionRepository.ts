import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  trackedEvent,
  trackedPageDaily,
  trackedVisitor,
  trackingCounter,
} from "@/db/schema";

// Website tracking's retention, across every organization at once (the
// cron's sweep). Nothing here is read back by an organization; each
// statement is bounded by `limit`.

/**
 * Rolls page views before `cutoff` into daily rows per page. A day rolled
 * twice keeps the larger count, so a sweep cut short and run again never
 * under-reports the part it already deleted.
 */
async function rollUpBefore(cutoff: string) {
  const day = sql<string>`substr(${trackedEvent.occurredAt}, 1, 10)`;
  await db
    .insert(trackedPageDaily)
    .select(
      db
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
            lt(trackedEvent.occurredAt, cutoff),
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
        views: sql`case when excluded.views > ${trackedPageDaily.views} then excluded.views else ${trackedPageDaily.views} end`,
        visitors: sql`case when excluded.visitors > ${trackedPageDaily.visitors} then excluded.visitors else ${trackedPageDaily.visitors} end`,
      },
    });
}

/** Deletes up to `limit` events before `cutoff`; how many went. */
async function deleteEventsBefore(cutoff: string, limit: number) {
  const removed = await db
    .delete(trackedEvent)
    .where(
      inArray(
        trackedEvent.id,
        db
          .select({ id: trackedEvent.id })
          .from(trackedEvent)
          .where(lt(trackedEvent.occurredAt, cutoff))
          .limit(limit),
      ),
    )
    .returning({ id: trackedEvent.id });
  return removed.length;
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
  rollUpBefore,
  deleteEventsBefore,
  deleteOrphanVisitors,
  deleteExpiredCounters,
};
