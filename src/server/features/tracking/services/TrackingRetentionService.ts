import { TrackingRetentionRepository } from "@/server/features/tracking/repositories/TrackingRetentionRepository";
import {
  EVENT_RETENTION_DAYS,
  retentionCutoff,
} from "@/server/features/tracking/trackingRules";

// Retention for every organization at once, from the hourly cron tick
// (src/server/cron.ts). Each run, in batches, until its time is up:
//
// 1. rolls the page views among a batch of events older than the cutoff
//    into daily rows, and deletes the batch, atomically (clicks are not page
//    views and are not rolled); a run out of time says so, and the next hour
//    carries on;
// 2. deletes form submissions as old, filed or not;
// 3. deletes visitors whose contact is gone and who have nothing left;
// 4. deletes rate counters whose window has passed.
//
// The cutoff is a whole UTC day.

const SWEEP_BATCH = 5_000;
/** How long a run starts batches for. */
const SWEEP_MS = 20_000;

async function sweepUntil(deadline: number, remove: () => Promise<number>) {
  let removed = 0;
  for (;;) {
    const deleted = await remove();
    removed += deleted;
    if (deleted < SWEEP_BATCH) return { removed, complete: true };
    if (Date.now() >= deadline) return { removed, complete: false };
  }
}

async function sweep(now: Date = new Date()) {
  const cutoff = retentionCutoff(now, EVENT_RETENTION_DAYS);
  const deadline = Date.now() + SWEEP_MS;
  const events = await sweepUntil(deadline, () =>
    TrackingRetentionRepository.rollUpAndDeleteBefore(cutoff, SWEEP_BATCH),
  );
  const submissions = await sweepUntil(deadline, () =>
    TrackingRetentionRepository.deleteSubmissionsBefore(cutoff, SWEEP_BATCH),
  );
  const visitors = await sweepUntil(deadline, () =>
    TrackingRetentionRepository.deleteOrphanVisitors(cutoff, SWEEP_BATCH),
  );
  const counters = await sweepUntil(deadline, () =>
    TrackingRetentionRepository.deleteExpiredCounters(
      now.toISOString(),
      SWEEP_BATCH,
    ),
  );
  if (!events.complete) {
    console.warn(
      "[tracking] retention ran out of time: older events remain until the next run",
      { removed: events.removed, retentionDays: EVENT_RETENTION_DAYS },
    );
  }
  const totals = {
    cutoff,
    events: events.removed,
    complete: events.complete,
    submissions: submissions.removed,
    visitors: visitors.removed,
    counters: counters.removed,
  };
  console.log("[tracking] retention swept", totals);
  return totals;
}

export const TrackingRetentionService = { sweep };
