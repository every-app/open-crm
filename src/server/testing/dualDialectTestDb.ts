import * as sqliteSchema from "@/db/d1/schema";
import * as pgSchema from "@/db/pg/schema";
import type { runBatch } from "@/db/runBatch";
import { createPgTestDb, createSqliteTestDb } from "@/server/testing/testDb";

type Dialect = "sqlite" | "postgres";

/**
 * Both test databases behind one switch, for tests that run the same code on
 * SQLite and Postgres. Serve `modules` from the mocked runtime modules and
 * each follows `use()`, `@/db/schema`'s tables included, so JSON and boolean
 * columns map the way that dialect maps them in production:
 *
 *   const { testDb } = await vi.hoisted(async () => {
 *     const { createDualDialectTestDb } = await import(
 *       "@/server/testing/dualDialectTestDb"
 *     );
 *     return { testDb: await createDualDialectTestDb() };
 *   });
 *   vi.mock("cloudflare:workers", () => testDb.modules.workers);
 *   vi.mock("@/db", () => testDb.modules.db);
 *   vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
 *   vi.mock("@/db/schema", () => testDb.modules.schema);
 */
export async function createDualDialectTestDb() {
  const databases = {
    sqlite: await createSqliteTestDb(),
    postgres: await createPgTestDb(),
  };
  const schemas: Record<Dialect, Record<string, unknown>> = {
    sqlite: sqliteSchema,
    postgres: pgSchema,
  };
  let dialect: Dialect = "sqlite";

  const schema: Record<string, unknown> = {};
  for (const name of Object.keys(sqliteSchema)) {
    Object.defineProperty(schema, name, {
      enumerable: true,
      get: () => schemas[dialect][name],
    });
  }
  const batch: typeof runBatch = (build) => databases[dialect].runBatch(build);
  const executeInBatches: typeof databases.sqlite.runBatchModule.executeInBatches =
    (items, build) =>
      databases[dialect].runBatchModule.executeInBatches(items, build);

  return {
    /** Points every mocked module at `next`'s database and returns it. */
    use(next: Dialect) {
      dialect = next;
      return databases[next];
    },
    modules: {
      workers: {
        env: {
          get DATABASE_PROVIDER() {
            return dialect === "postgres" ? "postgres" : "d1";
          },
        },
      },
      db: {
        get db() {
          return databases[dialect].db;
        },
      },
      runBatch: {
        DB_BATCH_SIZE: databases.sqlite.runBatchModule.DB_BATCH_SIZE,
        runBatch: batch,
        executeInBatches,
      },
      schema,
    },
  };
}
