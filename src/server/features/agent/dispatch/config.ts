const MINUTE_MS = 60_000;

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

  sweep: {
    // A tick stops taking on new work after this long; what it started still
    // settles (ctx.waitUntil).
    timeoutMs: 4 * MINUTE_MS,
    startTimeoutMs: MINUTE_MS,
    itemTimeoutMs: 2 * MINUTE_MS,
  },
} as const;
