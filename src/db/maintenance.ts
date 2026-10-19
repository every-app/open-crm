import { sql } from "drizzle-orm";
import { d1Db } from "./d1/client";
import { pgDb } from "./pg/client";
import { getDatabaseProvider } from "./provider";

// What each backend needs asked of it directly (docs/maintainers/database.md).

/**
 * Keeps D1's query planner informed. SQLite plans without statistics until
 * ANALYZE runs, and without them it picks the wrong index for the company
 * list's counts. `PRAGMA optimize` analyzes each table with an index that
 * has none yet (a migration's new indexes) or that has grown tenfold, within
 * a time limit. The daily cron runs it. Postgres keeps its own (autovacuum).
 */
export async function refreshStatistics(): Promise<void> {
  if (getDatabaseProvider() === "postgres") return;
  const result = await d1Db.run(sql`PRAGMA optimize`);
  console.log("[database] statistics refreshed", {
    durationMs: result.meta.duration,
  });
}

/** Which database this is and its size, for the dispatcher's health check. */
export async function databaseSize(): Promise<{
  provider: "d1" | "postgres";
  sizeBytes: number;
}> {
  if (getDatabaseProvider() === "postgres") {
    const [row] = await pgDb.execute<{ size: string }>(
      sql`select pg_database_size(current_database()) as size`,
    );
    return { provider: "postgres", sizeBytes: Number(row?.size) };
  }
  // D1 reports the database's size with every statement it runs.
  const result = await d1Db.run(sql`select 1`);
  return { provider: "d1", sizeBytes: result.meta.size_after };
}
