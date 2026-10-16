import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { sort } from "remeda";
import type { runBatch } from "@/db/runBatch";
import * as sqliteSchema from "@/db/d1/schema";
import * as pgSchema from "@/db/pg/schema";

// Real databases for tests, with every production migration applied, so
// repositories and services run their real queries, indexes and constraints.
// Create one inside `vi.hoisted` and serve it from mocked `@/db` and
// `@/db/runBatch` (as OpenSEO's aiVisibilityTestDb does):
//
//   const { testDb } = await vi.hoisted(async () => {
//     const { createSqliteTestDb } = await import("@/server/testing/testDb");
//     return { testDb: await createSqliteTestDb() };
//   });
//   vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
//   vi.mock("@/db", () => ({ db: testDb.db }));
//   vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
//
// createPgTestDb is the same against Postgres (PGlite, in-process), for code
// whose behaviour depends on the dialect: conflict targets, partial indexes,
// conditional updates. Both are typed as the D1 client, as `@/db` is.

function migrationFiles(dir: string): string[] {
  return sort(
    readdirSync(dir).filter((file) => file.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  ).map((file) => readFileSync(`${dir}/${file}`, "utf8"));
}

function statements(migration: string): string[] {
  return migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

type TestDatabase = typeof import("@/db").db;

/** In-memory SQLite (libsql) with drizzle/sqlite applied. */
export async function createSqliteTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const migration of migrationFiles("drizzle/sqlite"))
    await client.executeMultiple(
      migration.replaceAll("--> statement-breakpoint", ""),
    );
  const libsql = drizzleLibsql(client, { schema: sqliteSchema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- libsql exposes the D1 SQLite query-builder surface the repositories use
  const db = libsql as unknown as TestDatabase;
  /** Runs the production statements in order, as D1's batch does. */
  const batch: typeof runBatch = async (build) => {
    for (const statement of build(db)) await statement;
  };
  return {
    db,
    runBatch: batch,
    exec: (sql: string) => client.executeMultiple(sql),
    rows: async (sql: string) => (await client.execute(sql)).rows,
    seedTwoOrganizations: async () => {
      await libsql.insert(sqliteSchema.user).values(SEED.users);
      await libsql.insert(sqliteSchema.organization).values(SEED.organizations);
      await libsql.insert(sqliteSchema.member).values(SEED.members);
    },
  };
}

/** In-process Postgres (PGlite) with drizzle/pg applied. */
export async function createPgTestDb() {
  const client = new PGlite();
  for (const migration of migrationFiles("drizzle/pg"))
    for (const statement of statements(migration)) await client.exec(statement);
  const pglite = drizzlePglite(client, { schema: pgSchema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Postgres client stands in for the D1-typed `db`, as in src/db/index.ts (guarded by schema-parity.test.ts)
  const db = pglite as unknown as TestDatabase;
  const batch: typeof runBatch = async (build) => {
    for (const statement of build(db)) await statement;
  };
  return {
    db,
    runBatch: batch,
    exec: async (sql: string) => {
      await client.exec(sql);
    },
    rows: async (sql: string) => (await client.query(sql)).rows,
    seedTwoOrganizations: async () => {
      await pglite.insert(pgSchema.user).values(SEED.users);
      await pglite.insert(pgSchema.organization).values(SEED.organizations);
      await pglite.insert(pgSchema.member).values(SEED.members);
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
