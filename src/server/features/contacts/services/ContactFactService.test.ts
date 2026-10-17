import { beforeEach, describe, expect, it, vi } from "vitest";

// Settling the agent's suggestions on both backends: facts are JSON, and a
// decision is a batch whose writes only follow its own claim on the fact.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { AgentFactRepository } from "@/server/features/agent/repositories/AgentFactRepository";
import { ContactFactService } from "./ContactFactService";
import { ContactService } from "./ContactService";

/** A fact the agent recorded about contact c1 of org_a. */
function fact(
  id: string,
  field: string,
  value: string,
  status: string,
  day = 1,
) {
  return `INSERT INTO contact_fact (id, organization_id, contact_id, field, value, score, band, evidence, method, status, observed_at) VALUES ('${id}', 'org_a', 'c1', '${field}', '${value}', 0.6, 'PROBABLE', '[{"kind":"web.cited-claim","detail":"Their talk bio says so"}]', 'search', '${status}', '2026-10-0${day}T00:00:00.000Z');`;
}

const accept = (factId: string, organizationId = "org_a") =>
  ContactFactService.decideFact(organizationId, "user_a", {
    factId,
    decision: "accept",
  });

const dismiss = (factId: string) =>
  ContactFactService.decideFact("org_a", "user_a", {
    factId,
    decision: "dismiss",
  });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ContactFactService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(
        `INSERT INTO contact (id, organization_id, first_name, title) VALUES ('c1', 'org_a', 'ana', 'Engineer');`,
      );
    });

    it("accepts a suggestion into its field and supersedes the field's older facts", async () => {
      await database.exec(
        [
          fact("f1", "title", "Staff Engineer", "APPLIED", 1),
          fact("f2", "title", "VP Engineering", "PROPOSED", 3),
          fact("f3", "title", "CTO", "DISMISSED", 2),
          fact("f4", "name", "Ana  Maria Zed", "PROPOSED", 4),
          fact("f5", "employer", "Acme", "PROPOSED", 5),
        ].join("\n"),
      );
      const before = await ContactService.getContact("org_a", "c1");
      expect(before.facts.map((item) => item.id)).toEqual([
        "f5",
        "f4",
        "f2",
        "f1",
      ]);
      expect(before.facts[0]?.evidence).toEqual([
        { kind: "web.cited-claim", detail: "Their talk bio says so" },
      ]);

      await expect(accept("f2")).resolves.toEqual({
        contactId: "c1",
        field: "title",
        applied: true,
      });
      await expect(dismiss("f2")).rejects.toMatchObject({ code: "CONFLICT" });
      await accept("f4");
      await dismiss("f5");

      expect(
        await database.rows(
          "SELECT id, status, decided_by_id FROM contact_fact ORDER BY id",
        ),
      ).toMatchObject([
        { id: "f1", status: "SUPERSEDED", decided_by_id: null },
        { id: "f2", status: "APPLIED", decided_by_id: "user_a" },
        // A dismissal stands: the agent never offers that value again.
        { id: "f3", status: "DISMISSED" },
        { id: "f4", status: "APPLIED" },
        { id: "f5", status: "DISMISSED", decided_by_id: "user_a" },
      ]);
      expect(await ContactService.getContact("org_a", "c1")).toMatchObject({
        firstName: "Ana",
        lastName: "Maria Zed",
        title: "VP Engineering",
        companyId: null,
      });
    });

    it("changes nothing when a suggestion was settled between its read and the decision", async () => {
      await database.exec(
        [
          fact("f1", "title", "Engineer", "APPLIED"),
          fact("f2", "title", "CTO", "DISMISSED"),
        ].join("\n"),
      );
      // Someone else dismissed f2 after this decision read it as proposed.
      await expect(
        AgentFactRepository.decide("org_a", {
          fact: { id: "f2", contactId: "c1", field: "title" },
          accept: true,
          decidedById: "user_a",
          write: { patch: { title: "CTO" }, expected: null },
        }),
      ).resolves.toBe(false);
      expect(
        await database.rows(
          "SELECT f.status, c.title FROM contact_fact f JOIN contact c ON c.id = f.contact_id ORDER BY f.id",
        ),
      ).toMatchObject([
        { status: "APPLIED", title: "Engineer" },
        { status: "DISMISSED", title: "Engineer" },
      ]);
    });

    it("keeps one organization's suggestions out of another's reach", async () => {
      await database.exec(fact("f1", "title", "CTO", "PROPOSED"));
      await expect(accept("f1", "org_b")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        await database.rows("SELECT status FROM contact_fact"),
      ).toMatchObject([{ status: "PROPOSED" }]);
    });
  });
}
