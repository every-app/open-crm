import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

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

import { db } from "@/db";
import { company, member, user } from "@/db/schema";
import { createFieldSchema, type FieldFilters } from "@/types/schemas/fields";
import { FieldsService } from "./FieldsService";
import { FieldValuesService } from "./FieldValuesService";

const addField = (
  input: Partial<z.input<typeof createFieldSchema>> & { label: string },
  organizationId = "org_a",
) =>
  FieldsService.create(
    organizationId,
    createFieldSchema.parse({
      entity: "COMPANY",
      type: "TEXT",
      agentFilled: false,
      ...input,
    }),
  );

const setValues = (recordId: string, values: Record<string, unknown>) =>
  FieldValuesService.setValues("org_a", "COMPANY", recordId, values);

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`FieldValuesService (${dialect})`, () => {
    const database = testDb.use(dialect);
    const addCompanies = (organizationId: string, ids: string[]) =>
      database.exec(
        `INSERT INTO company (id, organization_id, name) VALUES ${ids
          .map((id) => `('${id}', '${organizationId}', 'Company ${id}')`)
          .join(", ")};`,
      );

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await addCompanies("org_a", ["acme"]);
    });

    it("stores a value of each type and reads it back as its type", async () => {
      const segment = await addField({
        label: "Segment",
        type: "SELECT",
        options: [{ label: "SMB" }, { label: "Enterprise" }],
      });
      for (const [label, type] of [
        ["Notes", "LONG_TEXT"],
        ["Runs on", "TEXT"],
        ["Seats", "NUMBER"],
        ["Renewal", "DATE"],
        ["Pilot", "CHECKBOX"],
        ["Pricing page", "URL"],
        ["Billing email", "EMAIL"],
        ["Hotline", "PHONE"],
        ["BDR", "USER"],
      ] as const) {
        await addField({ label, type });
      }

      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        segment: "enterprise",
        notes: "Line one\nline two",
        runs_on: "  AWS ",
        seats: "12.345678",
        renewal: "2027-03-31",
        pilot: true,
        pricing_page: "acme.com/pricing",
        billing_email: "Billing@Acme.com",
        hotline: "+1 555 0100",
        bdr: "user_a",
      });

      const values = Object.fromEntries(
        (await FieldValuesService.recordFields("org_a", "COMPANY", "acme")).map(
          (field) => [field.key, field.value],
        ),
      );
      expect(values).toEqual({
        segment: segment.options[1]?.id,
        notes: "Line one\nline two",
        runs_on: "AWS",
        seats: 12.3457,
        renewal: "2027-03-31T00:00:00.000Z",
        pilot: true,
        pricing_page: "https://acme.com/pricing",
        billing_email: "billing@acme.com",
        hotline: "+1 555 0100",
        bdr: "user_a",
      });
    });

    it("refuses a value that doesn't fit its field, and writes none of the others", async () => {
      await addField({ label: "Runs on" });
      await addField({ label: "Seats", type: "NUMBER" });
      await addField({ label: "Renewal", type: "DATE" });
      await addField({ label: "Pricing page", type: "URL" });
      await addField({ label: "Owner since", type: "TEXT", required: true });

      for (const values of [
        { seats: "a dozen" },
        { renewal: "2027-02-30" },
        { pricing_page: "javascript:alert(1)" },
        { owner_since: "  " },
        { no_such_field: "x" },
      ]) {
        await expect(
          FieldValuesService.setValues("org_a", "COMPANY", "acme", {
            runs_on: "AWS",
            ...values,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }
      expect(await database.rows("SELECT id FROM field_value")).toHaveLength(0);
    });

    it("refuses a user who doesn't work in the organization", async () => {
      await addField({ label: "BDR", type: "USER" });

      await expect(
        FieldValuesService.setValues("org_a", "COMPANY", "acme", {
          bdr: "user_b",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("keeps one row per field and record, and clears it with null", async () => {
      await addField({ label: "Runs on" });

      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        runs_on: "AWS",
      });
      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        runs_on: "GCP",
      });
      expect(await database.rows("SELECT text FROM field_value")).toEqual([
        { text: "GCP" },
      ]);

      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        runs_on: null,
      });
      expect(await database.rows("SELECT id FROM field_value")).toHaveLength(0);
    });

    it("fills only blanks when asked to, and says what it left alone", async () => {
      await addField({ label: "Runs on" });
      await addField({ label: "Region" });
      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        runs_on: "AWS",
      });

      const result = await FieldValuesService.setValues(
        "org_a",
        "COMPANY",
        "acme",
        { runs_on: "GCP", region: "EU" },
        { onlyIfEmpty: true },
      );

      expect(result).toEqual({ written: ["region"], skipped: ["runs_on"] });
      const values = await FieldValuesService.recordFields(
        "org_a",
        "COMPANY",
        "acme",
      );
      expect(values.map((field) => field.value)).toEqual(["AWS", "EU"]);
    });

    it("reads table values for a page of records larger than one query", async () => {
      const ids = Array.from({ length: 120 }, (_, index) => `co_${index}`);
      await addCompanies("org_a", ids);
      const tier = await addField({
        label: "Tier",
        type: "SELECT",
        options: [{ label: "Gold" }],
        showOnTable: true,
      });
      await addField({ label: "Hidden note" });
      for (const id of ids) {
        await FieldValuesService.setValues("org_a", "COMPANY", id, {
          tier: tier.options[0]?.id ?? null,
          hidden_note: "not a column",
        });
      }

      const values = await FieldValuesService.tableValues("org_a", "COMPANY", [
        ...ids,
        "acme",
      ]);

      expect(Object.keys(values)).toHaveLength(120);
      expect(values.co_119).toEqual({ tier: "Gold" });
    });

    it("turns each kind of field filter into the list's condition", async () => {
      await addCompanies("org_a", ["globex", "initech", "blank"]);
      await db
        .insert(user)
        .values({ id: "user_c", name: "Cy", email: "cy@a.test" });
      await db.insert(member).values({
        id: "m_c",
        organizationId: "org_a",
        userId: "user_c",
        role: "member",
        createdAt: new Date(0),
      });
      const segment = await addField({
        label: "Segment",
        type: "SELECT",
        options: [{ label: "SMB" }, { label: "Enterprise" }],
      });
      await addField({ label: "Runs on" });
      await addField({ label: "Seats", type: "NUMBER" });
      await addField({ label: "Renewal", type: "DATE" });
      await addField({ label: "Pilot", type: "CHECKBOX" });
      await addField({ label: "BDR", type: "USER" });
      await setValues("acme", {
        segment: "SMB",
        runs_on: "AWS 100%",
        seats: 10,
        renewal: "2027-03-31",
        pilot: true,
        bdr: "user_a",
      });
      await setValues("globex", {
        segment: "Enterprise",
        runs_on: "aws-ish",
        seats: 250,
        renewal: "2027-04-01",
        pilot: false,
        bdr: "user_c",
      });
      await setValues("initech", { runs_on: "GCP", seats: 40 });

      const matching = async (filters: FieldFilters) => {
        const conditions = await FieldValuesService.filterConditions(
          "org_a",
          "COMPANY",
          filters,
        );
        const rows = await db
          .select({ id: company.id })
          .from(company)
          .where(and(eq(company.organizationId, "org_a"), ...conditions))
          .orderBy(company.id);
        return rows.map((row) => row.id);
      };

      expect(
        await matching({ runs_on: { op: "contains", value: "AWS" } }),
      ).toEqual(["acme", "globex"]);
      expect(
        await matching({ runs_on: { op: "contains", value: "%" } }),
      ).toEqual(["acme"]);
      expect(
        await matching({ runs_on: { op: "equals", value: "gcp" } }),
      ).toEqual(["initech"]);
      expect(
        await matching({ seats: { op: "range", min: 20, max: 250 } }),
      ).toEqual(["globex", "initech"]);
      expect(
        await matching({
          renewal: { op: "dateRange", from: "2027-03-01", to: "2027-03-31" },
        }),
      ).toEqual(["acme"]);
      expect(await matching({ pilot: { op: "checked", value: true } })).toEqual(
        ["acme"],
      );
      expect(
        await matching({ pilot: { op: "checked", value: false } }),
      ).toEqual(["blank", "globex", "initech"]);
      expect(
        await matching({
          segment: { op: "anyOf", values: [segment.options[1]?.id ?? ""] },
        }),
      ).toEqual(["globex"]);
      expect(
        await matching({ bdr: { op: "anyOf", values: ["user_a", "user_c"] } }),
      ).toEqual(["acme", "globex"]);
      expect(
        await matching({
          runs_on: { op: "contains", value: "aws" },
          seats: { op: "range", min: 100 },
        }),
      ).toEqual(["globex"]);
      expect(
        await matching({
          gone: { op: "equals", value: "x" },
          seats: { op: "contains", value: "1" },
        }),
      ).toEqual(["acme", "blank", "globex", "initech"]);
    });

    it("keeps one organization's records out of another's reach", async () => {
      await addField({ label: "Runs on", showOnTable: true });
      await addField({ label: "Runs on", showOnTable: true }, "org_b");
      await FieldValuesService.setValues("org_a", "COMPANY", "acme", {
        runs_on: "AWS",
      });

      await expect(
        FieldValuesService.recordFields("org_b", "COMPANY", "acme"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        FieldValuesService.setValues("org_b", "COMPANY", "acme", {
          runs_on: "GCP",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await FieldValuesService.tableValues("org_b", "COMPANY", ["acme"]),
      ).toEqual({});
      expect(await database.rows("SELECT text FROM field_value")).toEqual([
        { text: "AWS" },
      ]);
    });
  });
}
