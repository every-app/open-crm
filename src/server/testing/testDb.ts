import { readdirSync, readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { sort } from "remeda";
import type { db as appDb } from "@/db";
import type { runBatch } from "@/db/runBatch";
import * as schema from "@/db/schema";

// A real database for tests, with every production migration applied, so
// repositories and services run their real queries, indexes and constraints.
// Create one inside `vi.hoisted` and serve it from mocked `@/db` and
// `@/db/runBatch` (as OpenSEO's aiVisibilityTestDb does):
//
//   const { testDb } = await vi.hoisted(async () => {
//     const { createSqliteTestDb } = await import("@/server/testing/testDb");
//     return { testDb: await createSqliteTestDb() };
//   });
//   vi.mock("cloudflare:workers", () => ({ env: {} }));
//   vi.mock("@/db", () => ({ db: testDb.db }));
//   vi.mock("@/db/runBatch", () => testDb.runBatchModule);
//
// It is typed as the D1 client, as `@/db` is.

function migrationFiles(dir: string): string[] {
  return sort(
    readdirSync(dir).filter((file) => file.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  ).map((file) => readFileSync(`${dir}/${file}`, "utf8"));
}

type TestDatabase = typeof appDb;

const TEST_BATCH_SIZE = 100;

/**
 * The `@/db/runBatch` module for a test database: its `runBatch`, and an
 * `executeInBatches` that chunks through it as production does. Mock it whole:
 * `vi.mock("@/db/runBatch", () => testDb.runBatchModule)`.
 */
function runBatchModule(batch: typeof runBatch) {
  return {
    DB_BATCH_SIZE: TEST_BATCH_SIZE,
    runBatch: batch,
    executeInBatches: async <T>(
      items: T[],
      build: (tx: TestDatabase, item: T) => Promise<unknown>,
    ) => {
      for (let i = 0; i < items.length; i += TEST_BATCH_SIZE) {
        const chunk = items.slice(i, i + TEST_BATCH_SIZE);
        await batch((tx) => chunk.map((item) => build(tx, item)));
      }
    },
  };
}

/** In-memory SQLite (libsql) with drizzle/sqlite applied. */
export async function createSqliteTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const migration of migrationFiles("drizzle/sqlite"))
    await client.executeMultiple(
      migration.replaceAll("--> statement-breakpoint", ""),
    );
  const libsql = drizzleLibsql(client, { schema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- libsql exposes the D1 SQLite query-builder surface the repositories use
  const db = libsql as unknown as TestDatabase;
  /** Runs the production statements in order, as D1's batch does. */
  const batch: typeof runBatch = async (build) => {
    for (const statement of build(db)) await statement;
  };
  return {
    db,
    /** The libsql client under `db`: spy on `execute` to see each statement. */
    client,
    runBatch: batch,
    runBatchModule: runBatchModule(batch),
    exec: (sql: string) => client.executeMultiple(sql),
    rows: async (sql: string) => (await client.execute(sql)).rows,
    seedTwoOrganizations: async () => {
      await libsql.insert(schema.user).values(SEED.users);
      await libsql.insert(schema.organization).values(SEED.organizations);
      await libsql.insert(schema.member).values(SEED.members);
    },
  };
}

/**
 * Two organizations with one owner each (`org_a`/`user_a`, `org_b`/`user_b`),
 * for isolation tests: everything one organization writes must stay out of
 * the other's reads.
 */
const SEED = {
  users: [
    { id: "user_a", name: "Ana", email: "ana@a.test", emailVerified: true },
    { id: "user_b", name: "Bo", email: "bo@b.test", emailVerified: true },
  ],
  organizations: [
    { id: "org_a", name: "Org A", slug: "org-a", createdAt: new Date(0) },
    { id: "org_b", name: "Org B", slug: "org-b", createdAt: new Date(0) },
  ],
  members: [
    {
      id: "m_a",
      organizationId: "org_a",
      userId: "user_a",
      role: "owner",
      createdAt: new Date(0),
    },
    {
      id: "m_b",
      organizationId: "org_b",
      userId: "user_b",
      role: "owner",
      createdAt: new Date(0),
    },
  ],
};
