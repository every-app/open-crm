import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSqliteTestDb } from "@/server/testing/testDb";
import type { Database } from "./db.ts";
import { lookupOrganization } from "./organization.ts";

// The operator scripts' SQL, run against SQLite with every migration applied.

const rows = z.array(z.record(z.string(), z.unknown()));

describe("operator scripts", () => {
  async function seeded() {
    const testDb = await createSqliteTestDb();
    await testDb.seedTwoOrganizations();
    await testDb.exec(`
      insert into company (id, organization_id, name) values ('co_a', 'org_a', 'Acme'), ('co_b', 'org_b', 'Bolt');
    `);
    const db: Database = {
      target: "test",
      query: async (sql) => rows.parse(await testDb.rows(sql)),
      close: async () => {},
    };
    return db;
  }

  it("looks up one organization, by a member's email, without the other's rows", async () => {
    const db = await seeded();
    const found = await lookupOrganization(db, "ANA@a.test");
    expect(found.organization).toMatchObject({ id: "org_a" });
    expect(found.counts).toMatchObject({ company: 1, contact: 0 });
  });
});
