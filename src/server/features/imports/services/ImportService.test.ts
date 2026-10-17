import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIORITY } from "@/shared/agent-tasks";
import type { ImportChunkInput } from "@/types/schemas/imports";

// CSV import on both backends: duplicates are found through partial unique
// indexes and lowercased lookups, and a chunk sent twice must change nothing
// the second time.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { ImportService } from "./ImportService";

const A = { organizationId: "org_a", userId: "user_a" };
const B = { organizationId: "org_b", userId: "user_b" };

function chunk(
  entity: ImportChunkInput["entity"],
  rows: Record<string, string>[],
  options: Partial<ImportChunkInput> = {},
): ImportChunkInput {
  return {
    entity,
    duplicates: "skip",
    research: false,
    dryRun: false,
    rows: rows.map((values, index) => ({ line: index + 2, values })),
    ...options,
  };
}

const outcomes = (result: { results: { outcome: string }[] }) =>
  result.results.map((row) => row.outcome);

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ImportService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM field_value; DELETE FROM activity; DELETE FROM deal; DELETE FROM contact; DELETE FROM company; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
    });

    it("finds companies by domain, skips or updates them, and creates nothing twice", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain) VALUES ('co_acme', 'org_a', 'acme.com', 'acme.com')`,
      );
      const rows = [
        { name: "Acme", domain: "https://www.acme.com", industry: "Anvils" },
        { name: "Globex", domain: "globex.com", owner: "ANA@a.test" },
        { name: "Initech" },
        { name: "Bad", domain: "not a domain" },
      ];
      const first = await ImportService.importChunk(A, chunk("COMPANY", rows));
      expect(outcomes(first)).toEqual([
        "skipped",
        "created",
        "created",
        "failed",
      ]);
      expect(first.results[3]?.error).toContain("is not a domain");
      // Sent again (an import re-run after it stopped): nothing new.
      expect(
        outcomes(await ImportService.importChunk(A, chunk("COMPANY", rows))),
      ).toEqual(["skipped", "skipped", "skipped", "failed"]);
      expect(
        outcomes(
          await ImportService.importChunk(
            A,
            chunk("COMPANY", rows.slice(0, 1), { duplicates: "update" }),
          ),
        ),
      ).toEqual(["updated"]);
      expect(
        await database.rows(
          "SELECT name, domain, industry, source, owner_id FROM company WHERE organization_id = 'org_a' ORDER BY name",
        ),
      ).toEqual([
        {
          name: "Acme",
          domain: "acme.com",
          industry: "Anvils",
          source: "MANUAL",
          owner_id: null,
        },
        {
          name: "Globex",
          domain: "globex.com",
          industry: null,
          source: "IMPORT",
          owner_id: "user_a",
        },
        {
          name: "Initech",
          domain: null,
          industry: null,
          source: "IMPORT",
          owner_id: null,
        },
      ]);
      // Another organization's import finds none of org_a's companies, and
      // org_a's members own nothing there.
      const other = await ImportService.importChunk(B, chunk("COMPANY", rows));
      expect(outcomes(other)).toEqual([
        "created",
        "failed",
        "created",
        "failed",
      ]);
      expect(other.results[1]?.error).toContain("Nobody in this workspace");
    });

    it("links contacts to their company and finds them by email", async () => {
      await database.exec(
        `INSERT INTO company (id, organization_id, name, domain) VALUES ('co_hooli', 'org_a', 'Hooli', NULL)`,
      );
      const rows = [
        { fullName: "Ana María Ruiz", email: "Ana@Initech.com" },
        { firstName: "Bo", email: "bo@initech.com", title: "CTO" },
        { firstName: "Cy", company: "hooli" },
        { firstName: "Di", email: "di@gmail" },
      ];
      const first = await ImportService.importChunk(A, chunk("CONTACT", rows));
      expect(outcomes(first)).toEqual([
        "created",
        "created",
        "created",
        "failed",
      ]);
      expect(
        await database.rows(
          `SELECT c.first_name, c.last_name, c.email, co.name AS company, c.source FROM contact c LEFT JOIN company co ON co.id = c.company_id WHERE c.organization_id = 'org_a' ORDER BY c.first_name`,
        ),
      ).toEqual([
        {
          first_name: "Ana",
          last_name: "María Ruiz",
          email: "ana@initech.com",
          company: "initech.com",
          source: "IMPORT",
        },
        {
          first_name: "Bo",
          last_name: null,
          email: "bo@initech.com",
          company: "initech.com",
          source: "IMPORT",
        },
        {
          first_name: "Cy",
          last_name: null,
          email: null,
          company: "Hooli",
          source: "IMPORT",
        },
      ]);
      const again = await ImportService.importChunk(
        A,
        chunk("CONTACT", rows, { duplicates: "update" }),
      );
      expect(outcomes(again)).toEqual([
        "updated",
        "updated",
        "updated",
        "failed",
      ]);
      expect(
        await database.rows(
          "SELECT count(*) AS n FROM company WHERE organization_id = 'org_a'",
        ),
      ).toEqual([{ n: 2 }]);
    });

    it("finds deals by name at their company, and converts what an update changes", async () => {
      const rows = [
        {
          name: "Renewal",
          company: "acme.com",
          stage: "Contract sent",
          amount: "$12,500.50",
          currency: "usd",
          closeDate: "2027-03-31",
        },
        { name: "Pilot", company: "Acme", stage: "lost" },
        { name: "Nowhere" },
      ];
      expect(
        outcomes(await ImportService.importChunk(A, chunk("DEAL", rows))),
      ).toEqual(["created", "created", "failed"]);
      expect(
        outcomes(
          await ImportService.importChunk(
            A,
            chunk("DEAL", [{ name: "renewal", company: "acme.com", amount: "9000" }], {
              duplicates: "update",
            }),
          ),
        ),
      ).toEqual(["updated"]);
      expect(
        await database.rows(
          "SELECT d.name, d.stage, d.amount, d.base_amount, d.currency, d.expected_close_date, d.owner_id, d.source FROM deal d WHERE d.organization_id = 'org_a' ORDER BY d.name",
        ),
      ).toMatchObject([
        { name: "Pilot", stage: "CLOSED_LOST", amount: null, source: "IMPORT" },
        {
          name: "Renewal",
          stage: "CONTRACT_SENT",
          amount: 9000,
          base_amount: 9000,
          currency: "USD",
          expected_close_date: "2027-03-31T00:00:00.000Z",
          owner_id: "user_a",
          source: "IMPORT",
        },
      ]);
      // "acme.com" and "Acme" are two companies: one by domain, one by name.
      expect(
        await database.rows(
          "SELECT name, domain FROM company WHERE organization_id = 'org_a' ORDER BY name",
        ),
      ).toEqual([
        { name: "Acme", domain: null },
        { name: "acme.com", domain: "acme.com" },
      ]);
    });

    it("writes nothing on a dry run, and paces the research for what it creates", async () => {
      const rows = [
        { name: "Acme", domain: "acme.com" },
        { name: "Globex", domain: "globex.com" },
      ];
      expect(
        outcomes(
          await ImportService.importChunk(
            A,
            chunk("COMPANY", [...rows, rows[0]!], { dryRun: true }),
          ),
        ),
      ).toEqual(["created", "created", "skipped"]);
      expect(
        await database.rows("SELECT count(*) AS n FROM company"),
      ).toEqual([{ n: 0 }]);

      await ImportService.importChunk(
        A,
        chunk("COMPANY", rows, { research: true }),
      );
      const tasks = await database.rows(
        "SELECT kind, priority, due_at FROM agent_task WHERE organization_id = 'org_a' ORDER BY kind, due_at",
      );
      expect(tasks.map((task) => [task.kind, task.priority])).toEqual([
        ["brand", PRIORITY.importedBrand],
        ["brand", PRIORITY.importedBrand],
        ["company-profile", PRIORITY.imported],
        ["company-profile", PRIORITY.imported],
      ]);
      const [first, second] = tasks
        .filter((task) => task.kind === "company-profile")
        .map((task) => Date.parse(String(task.due_at)));
      expect(second! - first!).toBe(30_000);
    });
  });
}
