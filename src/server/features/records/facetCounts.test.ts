import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

// The record lists' facet counts: how many records the
// list's search finds (live or archived) have each value of each filter,
// whatever the other filters, and none of another organization's.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { DealService } from "@/server/features/deals/services/DealService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { companyListSchema } from "@/types/schemas/companies";
import { contactListSchema } from "@/types/schemas/contacts";
import { dealListSchema } from "@/types/schemas/deals";
import { createFieldSchema } from "@/types/schemas/fields";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

const companyCounts = async (input: object) =>
  (await CompanyService.listCompanies("org_a", companyListSchema.parse(input)))
    .facetCounts;

describe("record list facet counts", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name, owner_id, industry, last_activity_at, archived_at) VALUES
          ('acme', 'org_a', 'Acme', 'user_a', 'Software', '${daysAgo(3)}', NULL),
          ('acme_labs', 'org_a', 'Acme Labs', 'user_a', 'Software', '${daysAgo(40)}', NULL),
          ('acme_co', 'org_a', 'Acme Co', NULL, NULL, NULL, NULL),
          ('acme_old', 'org_a', 'Acme Old', 'user_a', 'Hardware', NULL, '${daysAgo(1)}'),
          ('globex', 'org_a', 'Globex', 'user_a', 'Fintech', NULL, NULL),
          ('acme_b', 'org_b', 'Acme', 'user_b', 'Mining', NULL, NULL);
      `);
  });

  it("counts the companies list's owners, industries and activity", async () => {
    // A filter that leaves no rows still counts its search's companies.
    expect(await companyCounts({ q: "acme", industry: ["Fintech"] })).toEqual({
      owner: { user_a: 2, unassigned: 1 },
      industry: { Software: 2 },
      activity: { "7": 1, "30": 1, "90": 2 },
    });
    expect(
      (await companyCounts({ q: "acme", archived: true })).industry,
    ).toEqual({ Hardware: 1 });
  });

  it("counts the contacts list's owners, companies, titles, seniorities, personas and activity", async () => {
    await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, company_id, title, seniority, "function", last_activity_at) VALUES
          ('ana', 'org_a', 'Ana', 'acme', 'CEO', 'Founder', 'Executive', '${daysAgo(2)}'),
          ('bo', 'org_a', 'Bo', NULL, 'CTO', 'C-level', 'Engineering', NULL),
          ('cy', 'org_a', 'Cy', 'globex', 'CEO', 'Founder', 'Executive', '${daysAgo(20)}'),
          ('di', 'org_b', 'Di', 'acme_b', 'Buyer', 'IC', 'Procurement', NULL);
      `);
    const counts = async (input: object) =>
      (
        await ContactService.listContacts(
          "org_a",
          contactListSchema.parse(input),
        )
      ).facetCounts;

    expect(await counts({ title: ["CTO"] })).toEqual({
      owner: { unassigned: 3 },
      company: { acme: 1, globex: 1, none: 1 },
      title: { CEO: 2, CTO: 1 },
      seniority: { Founder: 2, "C-level": 1 },
      persona: { Executive: 2, Engineering: 1 },
      activity: { "7": 1, "30": 2, "90": 2 },
    });
    // The search reads the company's name.
    expect((await counts({ q: "globex" })).company).toEqual({ globex: 1 });
  });

  it("counts the deals list's statuses, owners, stages and closing windows", async () => {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    await database.exec(`
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, expected_close_date) VALUES
          ('renewal', 'org_a', 'Renewal', 'acme', 'user_a', 'DEMO_BOOKED', '${today}'),
          ('upsell', 'org_a', 'Upsell', 'acme_labs', 'user_a', 'CONTRACT_SENT', '2020-01-01T00:00:00.000Z'),
          ('won', 'org_a', 'Won', 'acme', 'user_a', 'CLOSED_WON', NULL),
          ('pilot', 'org_a', 'Pilot', 'globex', 'user_a', 'DEMO_BOOKED', NULL),
          ('other', 'org_b', 'Acme deal', 'acme_b', 'user_b', 'DEMO_BOOKED', NULL);
      `);

    const { rows, facetCounts } = await DealService.listDeals(
      "org_a",
      dealListSchema.parse({ q: "acme", stage: ["CLOSED_LOST"] }),
    );
    expect(rows).toEqual([]);
    expect(facetCounts).toEqual({
      status: { open: 2, closed: 1 },
      owner: { user_a: 3 },
      stage: { DEMO_BOOKED: 1, CONTRACT_SENT: 1, CLOSED_WON: 1 },
      closing: {
        overdue: 1,
        "this-month": 1,
        "next-month": 0,
        later: 0,
        none: 1,
      },
    });
  });

  it("counts the options of select fields and the members of user fields", async () => {
    const addField = (input: Partial<z.input<typeof createFieldSchema>>) =>
      FieldsService.create(
        "org_a",
        createFieldSchema.parse({
          entity: "COMPANY",
          ...input,
        }),
      );
    const tier = await addField({
      label: "Tier",
      type: "SELECT",
      options: [{ label: "Gold" }, { label: "Silver" }],
    });
    await addField({ label: "Champion", type: "USER" });
    for (const [id, values] of [
      ["acme", { tier: "Gold", champion: "user_a" }],
      ["acme_labs", { tier: "Gold" }],
      ["acme_co", { tier: "Silver" }],
      ["globex", { tier: "Gold" }],
    ] as const) {
      await FieldValuesService.setValues("org_a", "COMPANY", id, values);
    }
    const [gold, silver] = tier.options.map((option) => option.id);

    expect(
      await companyCounts({
        q: "acme",
        fields: { tier: { op: "anyOf", values: [silver] } },
      }),
    ).toMatchObject({
      "field:tier": { [gold]: 2, [silver]: 1 },
      "field:champion": { user_a: 1 },
    });
  });
});
