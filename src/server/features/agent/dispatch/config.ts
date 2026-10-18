const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How much the dispatcher takes on per tick, and how long it holds what it
 * took. The CRM's numbers: the visible lane (no model) runs many at once on a
 * short lease; the research lane starts one session per task on a lease long
 * enough for a session to finish and report back.
 */
export const DISPATCH = {
  visible: {
    batch: 60,
    concurrency: 6,
    leaseMs: 6 * MINUTE_MS,
  },

  research: {
    batch: 12,
    leaseMs: 30 * MINUTE_MS,
    link: { attempts: 3, retryMs: 250 },
  },

  reconcile: {
    scan: 200,
    retire: 100,
  },

  // The enrichment sweep (dispatch/sweep.ts), the CRM's automatic backfill,
  // which it ran at most every five minutes. Its limits are per organization
  // and run, as they were per install; `organizations` bounds a tick.
  enrichment: {
    everyMs: 5 * MINUTE_MS,
    organizations: 20,
    maxPerRun: 500,
    // How long a look that found nothing stands a record down: a photo or a
    // logo a month, the workspace's own profile a week.
    photoRecheckMs: 30 * DAY_MS,
    artworkRecheckMs: 30 * DAY_MS,
    workspaceRecheckMs: 7 * DAY_MS,
    // Between tries at a record whose research failed. The CRM retried on
    // every sweep, which ran when someone signed in; the minute cron would
    // retry it every five minutes.
    failedRetryMs: DAY_MS,
  },

  sweep: {
    // A tick stops taking on new work after this long; what it started still
    // settles (ctx.waitUntil).
    timeoutMs: 4 * MINUTE_MS,
    startTimeoutMs: MINUTE_MS,
    itemTimeoutMs: 2 * MINUTE_MS,
  },
} as const;
