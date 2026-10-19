import { sql } from "drizzle-orm";
import { d1Db } from "./d1/client";
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
