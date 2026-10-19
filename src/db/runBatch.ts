import { db } from "@/db";

// The executor handed to the `build` callback, and one statement it returns.
type BatchExecutor = typeof db;
type BatchStatement = Parameters<typeof db.batch>[0][number];

// D1 caps bound parameters at ~100 per statement; keep batches bounded so each
// runBatch call stays under that limit.
const DB_BATCH_SIZE = 100;

/**
 * Run a set of write statements atomically, in order, as one D1 batch.
 * Returning the (unawaited) Drizzle query builders the `tx` handle builds is
 * enough.
 */
export async function runBatch(
  build: (tx: BatchExecutor) => readonly Promise<unknown>[],
): Promise<void> {
  const statements = build(db);
  if (statements.length === 0) return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- d1 query builders are BatchItems; length checked above
  const batch = statements as unknown as [BatchStatement, ...BatchStatement[]];
  await db.batch(batch);
}

/**
 * Chunk `items` into D1-safe batches and run each chunk atomically via
 * `runBatch`. Shared by repositories that bulk-insert or update.
 */
export async function executeInBatches<T>(
  items: T[],
  buildStatement: (tx: BatchExecutor, item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += DB_BATCH_SIZE) {
    const chunk = items.slice(i, i + DB_BATCH_SIZE);
    if (chunk.length === 0) continue;
    await runBatch((tx) => chunk.map((item) => buildStatement(tx, item)));
  }
}
