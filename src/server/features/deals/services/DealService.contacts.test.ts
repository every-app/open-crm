import { beforeEach, describe, expect, it, vi } from "vitest";

// The people on a deal: attaching is an upsert on
// deal_contact's primary key, and the picker leaves out who's already on it.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { DealService } from "./DealService";

const A = "org_a";

describe("DealService contacts", () => {
  beforeEach(async () => {
    await database.exec(`
        DELETE FROM deal_contact; DELETE FROM deal; DELETE FROM contact; DELETE FROM company;
        DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";
      `);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme'), ('beta', 'org_a', 'Beta Labs');
      `);
  });

  const create = (name: string) =>
    DealService.createDeal(A, { name, companyId: "acme", ownerId: "user_a" });

  it("brings only people from the deal's company onto it, each with a role", async () => {
    const deal = await create("Renewal");
    await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, company_id) VALUES ('ana', 'org_a', 'Ana', 'acme'), ('bo', 'org_a', 'Bo', 'beta');
        INSERT INTO contact (id, organization_id, first_name, company_id, archived_at) VALUES ('old', 'org_a', 'Old', 'acme', '2026-10-01T00:00:00.000Z');
      `);
    const attach = (contactId: string, role?: string | null) =>
      DealService.attachContact(A, { dealId: deal.id, contactId, role });
    const onDeal = async () =>
      (await DealService.getDeal(A, deal.id)).contacts.map(({ id, role }) => ({
        id,
        role,
      }));

    expect(await DealService.contactOptions(A, deal.id)).toMatchObject([
      { id: "ana" },
    ]);
    await expect(attach("bo")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(attach("old")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await attach("ana", " Champion ");
    await attach("ana");
    expect(await onDeal()).toEqual([{ id: "ana", role: "Champion" }]);
    expect(await DealService.contactOptions(A, deal.id)).toEqual([]);

    await DealService.setContactRole(A, {
      dealId: deal.id,
      contactId: "ana",
      role: " ",
    });
    expect(await onDeal()).toEqual([{ id: "ana", role: null }]);
    await DealService.detachContact(A, deal.id, "ana");
    expect(await onDeal()).toEqual([]);
    await expect(
      DealService.detachContact(A, deal.id, "ana"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
