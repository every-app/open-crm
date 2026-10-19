import { sql } from "drizzle-orm";
import { db } from "@/db";

// What D1 needs asked of it directly (docs/maintainers/database.md).

/**
 * Keeps D1's query planner informed. SQLite plans without statistics until
 * ANALYZE runs, and without them it picks the wrong index for the company
 * list's counts. `PRAGMA optimize` analyzes each table with an index that
 * has none yet (a migration's new indexes) or that has grown tenfold, within
 * a time limit. The daily cron runs it.
 */
export async function refreshStatistics(): Promise<void> {
  const result = await db.run(sql`PRAGMA optimize`);
  console.log("[database] statistics refreshed", {
    durationMs: result.meta.duration,
  });
}

/** The database's size, for the dispatcher's health check. */
export async function databaseSize(): Promise<{
  provider: "d1";
  sizeBytes: number;
}> {
  // D1 reports the database's size with every statement it runs.
  const result = await db.run(sql`select 1`);
  return { provider: "d1", sizeBytes: result.meta.size_after };
}
