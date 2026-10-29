// A small concurrency helper, ported from the CRM's lib/pool.ts.

/** Runs `run` over `items`, at most `concurrency` at a time. */
export async function runLimited<T>(
  concurrency: number,
  items: readonly T[],
  run: (item: T) => Promise<void>,
): Promise<void> {
  const width = Math.max(1, Math.min(concurrency, items.length));
  const queue = items[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (const item of queue) await run(item);
    }),
  );
}
