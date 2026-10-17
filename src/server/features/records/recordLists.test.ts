import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The record lists with custom fields, on both backends: field filters join
// the list's own WHERE (search, owner, stage, totals), rows carry the values
// of the fields shown as columns, and nothing crosses organizations.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { DealService } from "@/server/features/deals/services/DealService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { DEAL_STAGES, type FieldEntity } from "@/shared/crm-enums";
import { companyListSchema } from "@/types/schemas/companies";
import { contactListSchema } from "@/types/schemas/contacts";
import { CLOSING_WINDOWS, dealListSchema } from "@/types/schemas/deals";
import { createFieldSchema } from "@/types/schemas/fields";

const addField = (
  organizationId: string,
  input: Partial<z.input<typeof createFieldSchema>> & {
    entity: FieldEntity;
    label: string;
  },
) =>
  FieldsService.create(
    organizationId,
    createFieldSchema.parse({ type: "TEXT", agentFilled: false, ...input }),
  );

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`record lists with custom fields (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO company (id, organization_id, name, owner_id) VALUES
          ('acme', 'org_a', 'Acme', 'user_a'),
          ('acme_labs', 'org_a', 'Acme Labs', 'user_a'),
          ('acme_co', 'org_a', 'Acme Co', 'user_a'),
          ('globex', 'org_a', 'Globex', 'user_a'),
          ('acme_b', 'org_b', 'Acme', 'user_b');
      `);
    });

    it("narrows the companies list by custom fields together with its search and owner filter, within the organization", async () => {
      const tier = await addField("org_a", {
        entity: "COMPANY",
        label: "Tier",
        type: "SELECT",
        options: [{ label: "Gold" }, { label: "Silver" }],
        showOnTable: true,
      });
      await addField("org_a", {
        entity: "COMPANY",
        label: "Seats",
        type: "NUMBER",
      });
      await addField("org_b", {
        entity: "COMPANY",
        label: "Seats",
        type: "NUMBER",
      });
      for (const [id, values] of [
        ["acme", { tier: "Gold", seats: 50 }],
        ["acme_labs", { tier: "Gold", seats: 500 }],
        ["acme_co", { tier: "Silver", seats: 50 }],
        ["globex", { tier: "Gold", seats: 80 }],
      ] as const) {
        await FieldValuesService.setValues("org_a", "COMPANY", id, values);
      }
      await FieldValuesService.setValues("org_b", "COMPANY", "acme_b", {
        seats: 50,
      });
      const list = (organizationId: string, input: object) =>
        CompanyService.listCompanies(
          organizationId,
          companyListSchema.parse({ sort: "name", ...input }),
        );
      const gold = tier.options[0]?.id ?? "";

      const { rows, total } = await list("org_a", {
        q: "acme",
        owner: ["user_a"],
        fields: {
          tier: { op: "anyOf", values: [gold] },
          seats: { op: "range", max: 100 },
        },
      });
      expect(total).toBe(1);
      // Only the fields shown on the table come along, a select as its label.
      expect(rows).toMatchObject([{ id: "acme", fields: { tier: "Gold" } }]);
      expect(rows[0]?.fields).not.toHaveProperty("seats");

      expect(
        (await list("org_b", { fields: { seats: { op: "range", max: 100 } } }))
          .rows,
      ).toMatchObject([{ id: "acme_b", fields: {} }]);
    });

    it("narrows the deals list and its pipeline value by custom fields together with the stage filter", async () => {
      await database.exec(`
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, amount, base_amount, base_currency) VALUES
          ('new_demo', 'org_a', 'New demo', 'acme', 'user_a', 'DEMO_BOOKED', 100, 100, 'USD'),
          ('new_sent', 'org_a', 'New sent', 'acme', 'user_a', 'CONTRACT_SENT', 200, 200, 'USD'),
          ('renewal_demo', 'org_a', 'Renewal demo', 'globex', 'user_a', 'DEMO_BOOKED', 400, 400, 'USD');
      `);
      await addField("org_a", {
        entity: "DEAL",
        label: "Pilot",
        type: "CHECKBOX",
      });
      for (const id of ["new_demo", "new_sent"]) {
        await FieldValuesService.setValues("org_a", "DEAL", id, {
          pilot: true,
        });
      }

      const result = await DealService.listDeals(
        "org_a",
        dealListSchema.parse({
          stage: ["DEMO_BOOKED"],
          fields: { pilot: { op: "checked", value: true } },
        }),
      );
      expect(result.rows.map((row) => row.id)).toEqual(["new_demo"]);
      expect(result.openValue).toBe(100);
    });
  });
}

describe("the fullest list query (sqlite)", () => {
  const database = testDb.use("sqlite");

  beforeEach(async () => {
    testDb.use("sqlite");
    await database.exec(
      `DELETE FROM agent_task; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
  });

  it("binds at most D1's 100 parameters a statement with every filter at its limit", async () => {
    const owner = [
      "unassigned",
      ...Array.from({ length: 19 }, (_, index) => `owner_${index}`),
    ];
    const fieldFilters: Record<string, unknown> = {
      // 1 + 19 and 10 × 2: the field filters' 40.
      bdr: {
        op: "anyOf",
        values: Array.from({ length: 19 }, (_, index) => `user_${index}`),
      },
    };
    for (let index = 0; index < 10; index += 1) {
      fieldFilters[`note_${index}`] = { op: "contains", value: "x" };
    }
    for (const entity of ["COMPANY", "CONTACT", "DEAL"] as const) {
      await addField("org_a", { entity, label: "BDR", type: "USER" });
      for (let index = 0; index < 10; index += 1) {
        await addField("org_a", { entity, label: `Note ${index}` });
      }
    }
    const common = {
      q: "one two three four five six seven",
      owner,
      fields: fieldFilters,
      page: 3,
    };
    const execute = vi.spyOn(database.client, "execute");

    await CompanyService.listCompanies(
      "org_a",
      companyListSchema.parse({ ...common, sort: "lastActivity" }),
    );
    await ContactService.listContacts(
      "org_a",
      contactListSchema.parse({ ...common, sort: "company" }),
    );
    await DealService.listDeals(
      "org_a",
      dealListSchema.parse({
        ...common,
        sort: "stage",
        status: "open",
        stage: DEAL_STAGES,
        closing: CLOSING_WINDOWS,
      }),
    );

    // Drizzle sends each statement as { sql, args }.
    const statementSchema = z.object({ args: z.array(z.unknown()) });
    const parameters = execute.mock.calls.map(
      ([statement]) =>
        statementSchema.safeParse(statement).data?.args.length ?? 0,
    );
    // The deals page binds 93 today.
    expect(Math.max(...parameters)).toBeGreaterThan(80);
    expect(Math.max(...parameters)).toBeLessThanOrEqual(100);
  });
});
