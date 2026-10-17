import { beforeEach, describe, expect, it, vi } from "vitest";

// Search leans on lower() and LIKE, which the two backends implement
// differently (SQLite's lower() is ASCII only), so both run every case.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { SearchService } from "./SearchService";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`SearchService (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO company (id, organization_id, name, domain, archived_at) VALUES
          ('acme', 'org_a', 'Acme', 'acme.com', NULL),
          ('ecole', 'org_a', 'École 42', 'ecole42.fr', NULL),
          ('old', 'org_a', 'Acme Old', 'acme-old.com', '2026-10-01T00:00:00.000Z');
        INSERT INTO contact (id, organization_id, first_name, last_name, email, company_id) VALUES
          ('ana', 'org_a', 'Ana', 'Zed', 'ana@acme.com', 'acme'),
          ('bo', 'org_a', 'Bo', NULL, 'bo@gmail.com', NULL);
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage) VALUES
          ('won', 'org_a', 'Acme renewal', 'acme', 'user_a', 'CLOSED_WON'),
          ('open', 'org_a', 'Acme expansion', 'acme', 'user_a', 'QUALIFIED_TO_BUY');
      `);
    });

    const hits = async (q: string, organizationId = "org_a") =>
      (await SearchService.quick(organizationId, q)).hits.map(
        (hit) => `${hit.kind}:${hit.label}:${hit.detail ?? ""}`,
      );

    it("finds live records of each kind by part of a name, in any case", async () => {
      expect(await hits("ACME")).toEqual([
        "company:Acme:acme.com",
        "contact:Ana Zed:Acme",
        "deal:Acme expansion:Acme",
        "deal:Acme renewal:Acme",
      ]);
      expect(await hits("ana zed")).toEqual(["contact:Ana Zed:Acme"]);
      expect(await hits("gmail")).toEqual(["contact:Bo:bo@gmail.com"]);
      expect(await hits("École")).toEqual(["company:École 42:ecole42.fr"]);
      expect(await hits("a")).toEqual([]);
      expect(await hits("a%")).toEqual([]);
    });

    it("keeps one organization's records out of another's search", async () => {
      expect(await hits("acme", "org_b")).toEqual([]);
    });
  });
}
