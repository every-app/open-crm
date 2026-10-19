import { beforeEach, describe, expect, it, vi } from "vitest";

// Companies: the live-domain rule is a partial unique index, and purge clears
// rows that have no foreign key.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { toClientError } from "@/server/lib/errors";
import { companyListSchema } from "@/types/schemas/companies";
import { CompanyDirectoryService } from "./CompanyDirectoryService";
import { CompanyService } from "./CompanyService";

const A = "org_a";
const B = "org_b";

describe("CompanyService", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM agent_event; DELETE FROM agent_task; DELETE FROM activity; DELETE FROM deal; DELETE FROM contact; DELETE FROM company; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
  });

  const create = (organizationId: string, name: string, domain?: string) =>
    CompanyService.createCompany(organizationId, { name, domain });

  const names = async (
    organizationId: string,
    input: Record<string, unknown> = {},
  ) => {
    const { rows } = await CompanyService.listCompanies(
      organizationId,
      companyListSchema.parse({ sort: "name", dir: "asc", ...input }),
    );
    return rows.map((row) => row.name);
  };

  it("keeps one live company per domain; an archived one keeps its domain", async () => {
    const acme = await create(A, "Acme", "https://www.Acme.com/pricing");
    expect(acme.domain).toBe("acme.com");
    // The agent goes to fetch the brand and write the profile, and the
    // team agents hear of it.
    expect(
      await database.rows(
        "SELECT kind, reason FROM agent_task WHERE organization_id = 'org_a' ORDER BY kind",
      ),
    ).toMatchObject([
      { kind: "agent-event", reason: "company.created" },
      { kind: "brand" },
      { kind: "company-profile" },
    ]);

    // The browser is told which company has the domain.
    const taken = await create(A, "Acme again", "acme.com").catch(
      (error: unknown) => error,
    );
    expect(getStandardErrorMessage(toClientError(taken))).toBe(
      "Acme already uses the domain acme.com.",
    );
    expect(
      await CompanyDirectoryService.companyForEmail(A, "ana@acme.com"),
    ).toBe(acme.id);
    // Another organization's Acme is its own.
    await expect(create(B, "Acme", "acme.com")).resolves.toMatchObject({
      domain: "acme.com",
    });

    await CompanyService.archiveCompany(A, acme.id);
    const second = await create(A, "Acme again", "acme.com");
    expect(
      await CompanyDirectoryService.companyForEmail(A, "bo@acme.com"),
    ).toBe(second.id);
    await expect(
      CompanyService.restoreCompany(A, acme.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      CompanyService.updateCompany(A, { id: second.id, domain: "" }),
    ).resolves.toMatchObject({ domain: null });
    await expect(
      CompanyService.restoreCompany(A, acme.id),
    ).resolves.toMatchObject({ name: "Acme" });
  });

  it("searches, filters and sorts the list, blanks last either way", async () => {
    const acme = await create(A, "Acme", "acme.com");
    const beta = await create(A, "beta labs", "beta.io");
    const gamma = await create(A, "Gamma");
    await CompanyService.updateCompany(A, { id: acme.id, ownerId: "user_a" });
    await database.exec(
      `UPDATE company SET last_activity_at = '2026-10-10T00:00:00.000Z' WHERE id = '${acme.id}'; UPDATE company SET last_activity_at = '2026-10-01T00:00:00.000Z' WHERE id = '${gamma.id}';`,
    );

    expect(await names(A, { q: "ACME" })).toEqual(["Acme"]);
    expect(await names(A, { q: "beta.io" })).toEqual(["beta labs"]);
    expect(await names(A, { q: "100%" })).toEqual([]);
    expect(await names(A, { owner: ["unassigned"] })).toEqual([
      "beta labs",
      "Gamma",
    ]);
    expect(await names(A, { owner: ["user_a", "unassigned"] })).toHaveLength(3);
    expect(await names(A, { sort: "lastActivity", dir: "desc" })).toEqual([
      "Acme",
      "Gamma",
      "beta labs",
    ]);
    expect(await names(A, { sort: "lastActivity", dir: "asc" })).toEqual([
      "Gamma",
      "Acme",
      "beta labs",
    ]);

    await CompanyService.bulkArchive(A, [beta.id]);
    expect(await names(A)).toEqual(["Acme", "Gamma"]);
    expect(await names(A, { archived: true })).toEqual(["beta labs"]);
    const { total } = await CompanyService.listCompanies(
      A,
      companyListSchema.parse({ sort: "name", page: 2, pageSize: 1 }),
    );
    expect(total).toBe(2);
  });

  it("shows a company's live contacts and deals with their owners, open deals first", async () => {
    const acme = await create(A, "Acme", "acme.com");
    await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, last_name, company_id) VALUES ('p1', 'org_a', 'Ana', 'Zed', '${acme.id}');
        INSERT INTO contact (id, organization_id, first_name, last_name, company_id, archived_at) VALUES ('p2', 'org_a', 'Old', 'Hand', '${acme.id}', '2026-10-01T00:00:00.000Z');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage) VALUES ('d1', 'org_a', 'Renewal', '${acme.id}', 'user_a', 'CLOSED_WON');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage) VALUES ('d2', 'org_a', 'Expansion', '${acme.id}', 'user_a', 'CONTRACT_SENT');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, archived_at) VALUES ('d3', 'org_a', 'Dead', '${acme.id}', 'user_a', 'DEMO_BOOKED', '2026-10-01T00:00:00.000Z');
      `);

    const { rows } = await CompanyService.listCompanies(
      A,
      companyListSchema.parse({}),
    );
    expect(rows[0]).toMatchObject({ contactCount: 1, openDealCount: 1 });

    const company = await CompanyService.getCompany(A, acme.id);
    expect(company.contacts).toMatchObject([{ id: "p1", owner: null }]);
    expect(company.deals).toMatchObject([
      { id: "d2", open: true, owner: { id: "user_a", name: "Ana" } },
      { id: "d1", open: false },
    ]);
  });

  it("counts every deal deleting a company forever takes, archived ones too", async () => {
    const acme = await create(A, "Acme", "acme.com");
    // The last row is another organization's, naming Acme: not Acme's.
    await database.exec(`
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d1', 'org_a', 'Renewal', '${acme.id}', 'user_a');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, archived_at) VALUES ('d2', 'org_a', 'Dead', '${acme.id}', 'user_a', '2026-10-01T00:00:00.000Z');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d3', 'org_b', 'Theirs', '${acme.id}', 'user_b');
      `);

    expect(await CompanyService.getCompany(A, acme.id)).toMatchObject({
      deals: [{ id: "d1" }],
      dealCount: 2,
    });
  });

  it("purges only an archived company, with the agent's rows, and restamps its contacts", async () => {
    const acme = await create(A, "Acme", "acme.com");
    const other = await create(A, "Other", "other.com");
    await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, company_id, last_activity_at) VALUES ('p1', 'org_a', 'Ana', '${acme.id}', '2026-10-10T00:00:00.000Z');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d1', 'org_a', 'Renewal', '${acme.id}', 'user_a');
        INSERT INTO activity (id, organization_id, type, company_id, contact_id, created_at) VALUES ('a1', 'org_a', 'NOTE', '${acme.id}', 'p1', '2026-10-10T00:00:00.000Z');
        INSERT INTO activity (id, organization_id, type, contact_id, created_at) VALUES ('a2', 'org_a', 'NOTE', 'p1', '2026-10-01T00:00:00.000Z');
        INSERT INTO agent_task (id, organization_id, deal_id, kind, reason, due_at) VALUES ('t1', 'org_a', 'd1', 'field-backfill', 'x', '2026-10-01T00:00:00.000Z');
        INSERT INTO agent_event (id, organization_id, session_id, company_id, type, data, emitted_at) VALUES ('e1', 'org_a', 's1', '${acme.id}', 'step', '{}', '2026-10-01T00:00:00.000Z');
      `);
    const agentRows = () =>
      database.rows(
        "SELECT coalesce(company_id, deal_id) AS about FROM agent_task UNION ALL SELECT company_id FROM agent_event",
      );

    await expect(CompanyService.purgeCompany(A, acme.id)).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    expect(await agentRows()).toHaveLength(8);

    await CompanyService.archiveCompany(A, acme.id);
    await CompanyService.purgeCompany(A, acme.id);

    // Only the other company's brand, profile and event tasks are left.
    expect(await agentRows()).toMatchObject([
      { about: other.id },
      { about: other.id },
      { about: other.id },
    ]);
    expect(await database.rows("SELECT id FROM deal")).toHaveLength(0);
    expect(
      await database.rows("SELECT company_id, last_activity_at FROM contact"),
    ).toMatchObject([
      { company_id: null, last_activity_at: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("makes only someone who works there primary, taking them off the company they left", async () => {
    const acme = await create(A, "Acme", "acme.com");
    const beta = await create(A, "Beta", "beta.io");
    await database.exec(
      `INSERT INTO contact (id, organization_id, first_name, company_id) VALUES ('p1', 'org_a', 'Ana', '${acme.id}');`,
    );
    await expect(
      CompanyService.setPrimaryContact(A, beta.id, "p1"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await CompanyService.setPrimaryContact(A, acme.id, "p1");

    await database.exec(
      `UPDATE contact SET company_id = '${beta.id}' WHERE id = 'p1';`,
    );
    await CompanyService.setPrimaryContact(A, beta.id, "p1");
    expect(
      await database.rows(
        "SELECT name, primary_contact_id FROM company ORDER BY name",
      ),
    ).toMatchObject([
      { name: "Acme", primary_contact_id: null },
      { name: "Beta", primary_contact_id: "p1" },
    ]);
  });

  it("sends the agent back when the domain changes, refusing a taken one", async () => {
    const acme = await create(A, "Acme", "acme.com");
    await create(A, "Beta", "beta.io");
    await database.exec(
      `UPDATE agent_task SET finished_at = '2026-10-01T00:00:00.000Z'; UPDATE company SET enrichment_status = 'COMPLETE', icon_url = 'https://acme.com/icon.png';`,
    );

    await expect(
      CompanyService.updateCompany(A, { id: acme.id, domain: "beta.io" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await CompanyService.updateCompany(A, {
      id: acme.id,
      domain: "acme.dev",
    });

    const company = await CompanyService.getCompany(A, acme.id);
    expect(company).toMatchObject({
      domain: "acme.dev",
      enrichmentStatus: "PENDING",
      iconUrl: null,
      queued: true,
    });
  });

  it("keeps every company of one organization out of another's reach", async () => {
    const acme = await create(A, "Acme", "acme.com");
    await CompanyService.archiveCompany(A, (await create(A, "Old")).id);

    expect(await names(B)).toEqual([]);
    expect(await names(B, { archived: true })).toEqual([]);
    expect(await CompanyService.companyOptions(B, "")).toEqual([]);
    for (const attempt of [
      CompanyService.getCompany(B, acme.id),
      CompanyService.updateCompany(B, { id: acme.id, name: "Mine" }),
      CompanyService.archiveCompany(B, acme.id),
      CompanyService.enrichCompany(B, acme.id),
      CompanyService.setPrimaryContact(B, acme.id, null),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // user_a is no member of org_b, and org_b's bulk writes reach nothing.
    await expect(
      CompanyService.bulkAssignOwner(B, [acme.id], "user_a"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    for (const result of [
      await CompanyService.bulkAssignOwner(B, [acme.id], "user_b"),
      await CompanyService.bulkArchive(B, [acme.id]),
      await CompanyService.bulkPurge(B, [acme.id]),
    ]) {
      expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    }
    expect(await CompanyService.getCompany(A, acme.id)).toMatchObject({
      name: "Acme",
      owner: null,
      archivedAt: null,
    });
  });
});
