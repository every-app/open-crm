// Small concurrency helpers for the dispatcher, ported from the CRM's
// lib/pool.ts and lib/deadline.ts.

/** Resolves with the work's value, or `{ settled: false }` after `timeoutMs`. */
export async function settledWithin<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
  });
  try {
    return await Promise.race([
      work.then((value) => ({ settled: true as const, value })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `run` over `items`, at most `concurrency` at a time. */
export async function runLimited<T>(
  concurrency: number,
  items: readonly T[],
  run: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const width = Math.max(1, Math.min(concurrency, items.length));
  const queue = items[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (const item of queue) {
        if (signal?.aborted) break;
        await run(item);
      }
    }),
  );
}

/**
 * Wraps `run` so that calls for the same key while one is in flight collapse
 * into one more run after it, rather than running side by side. Forty new
 * companies poke forty times; their organization gets one visible lane in this
 * isolate, which runs again once if more work arrived meanwhile.
 */
export function collapsingByKey(
  run: (key: string) => Promise<void>,
): (key: string) => Promise<void> {
  const active = new Map<string, { again: boolean }>();
  return async (key) => {
    const current = active.get(key);
    if (current) {
      current.again = true;
      return;
    }
    const state = { again: true };
    active.set(key, state);
    try {
      while (state.again) {
        state.again = false;
        await run(key);
      }
    } finally {
      active.delete(key);
    }
  };
}
