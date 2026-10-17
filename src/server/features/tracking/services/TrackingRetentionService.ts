import { TrackingRetentionRepository } from "@/server/features/tracking/repositories/TrackingRetentionRepository";
import {
  EVENT_RETENTION_DAYS,
  retentionCutoff,
} from "@/server/features/tracking/trackingRules";

// Retention for every organization at once, from the hourly cron tick
// (src/server/cron.ts). Each run:
//
// 1. rolls page views older than the cutoff into daily rows, before
//    anything is deleted (clicks are not page views and are not rolled);
// 2. deletes those events, in bounded passes; a run that hits the ceiling
//    says so, and the next hour carries on (a day rolled twice keeps its
//    larger count, so the rerun never under-reports what was deleted);
// 3. deletes visitors whose contact is gone and who have nothing left;
// 4. deletes rate counters whose window has passed.
//
// The cutoff is a whole UTC day, so no calendar day is split across runs.

const SWEEP_BATCH = 5_000;
const MAX_SWEEP_PASSES = 20;

async function sweepPasses(remove: () => Promise<number>) {
  let removed = 0;
  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass += 1) {
    const deleted = await remove();
    removed += deleted;
    if (deleted < SWEEP_BATCH) return { removed, complete: true };
  }
  return { removed, complete: false };
}

async function sweep(now: Date = new Date()) {
  const cutoff = retentionCutoff(now, EVENT_RETENTION_DAYS);
  await TrackingRetentionRepository.rollUpBefore(cutoff);
  const events = await sweepPasses(() =>
    TrackingRetentionRepository.deleteEventsBefore(cutoff, SWEEP_BATCH),
  );
  const visitors = await sweepPasses(() =>
    TrackingRetentionRepository.deleteOrphanVisitors(cutoff, SWEEP_BATCH),
  );
  const counters = await sweepPasses(() =>
    TrackingRetentionRepository.deleteExpiredCounters(
      now.toISOString(),
      SWEEP_BATCH,
    ),
  );
  if (!events.complete) {
    console.warn(
      "[tracking] retention hit its pass limit: older events remain until the next run",
      { removed: events.removed, retentionDays: EVENT_RETENTION_DAYS },
    );
  }
  const totals = {
    cutoff,
    events: events.removed,
    complete: events.complete,
    visitors: visitors.removed,
    counters: counters.removed,
  };
  console.log("[tracking] retention swept", totals);
  return totals;
}

export const TrackingRetentionService = { sweep };
