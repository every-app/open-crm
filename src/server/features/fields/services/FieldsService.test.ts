import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { createFieldSchema } from "@/types/schemas/fields";
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
      ...input,
    }),
  );

const setValues = (recordId: string, values: Record<string, unknown>) =>
  FieldValuesService.setValues("org_a", "COMPANY", recordId, values);

describe("FieldsService", () => {
  const addCompanies = (
    organizationId: string,
    ids: string[],
    archivedAt: string | null = null,
  ) =>
    database.exec(
      `INSERT INTO company (id, organization_id, name, archived_at) VALUES ${ids
        .map(
          (id) =>
            `('${id}', '${organizationId}', 'Company ${id}', ${archivedAt ? `'${archivedAt}'` : "null"})`,
        )
        .join(", ")};`,
    );

  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  it("makes the key from the label and puts a new field last", async () => {
    await addField({ label: "Runs on" });
    const segment = await addField({
      label: "Segment",
      type: "SELECT",
      options: [{ label: "SMB" }, { label: "Enterprise" }],
    });

    expect(segment).toMatchObject({
      key: "segment",
      position: 1,
      options: [{ label: "SMB" }, { label: "Enterprise" }],
    });
    const fields = await FieldsService.list("org_a", "COMPANY");
    expect(fields.map((field) => field.key)).toEqual(["runs_on", "segment"]);
  });

  it("refuses a key another field has, even an archived one", async () => {
    const field = await addField({ label: "Runs on" });
    await FieldsService.archive("org_a", field.id);

    await expect(addField({ label: "Runs  on!" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("changes a field's type only while it holds no values", async () => {
    await addCompanies("org_a", ["acme"]);
    const field = await addField({ label: "Seats" });
    await FieldsService.update("org_a", { id: field.id, type: "NUMBER" });
    await setValues("acme", { seats: 12 });

    await expect(
      FieldsService.update("org_a", { id: field.id, type: "TEXT" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("retires a removed option, and the records that hold it still show it", async () => {
    await addCompanies("org_a", ["acme"]);
    const field = await addField({
      label: "Segment",
      type: "SELECT",
      options: [{ label: "SMB" }, { label: "Partner" }],
    });
    const [smb, partner] = field.options;
    await setValues("acme", { segment: "Partner" });

    const updated = await FieldsService.update("org_a", {
      id: field.id,
      options: [
        { id: smb?.id, label: "Small business" },
        { label: "Enterprise" },
      ],
    });

    expect(updated.options.map((option) => option.label)).toEqual([
      "Small business",
      "Enterprise",
    ]);
    const [onRecord] = await FieldValuesService.recordFields(
      "org_a",
      "COMPANY",
      "acme",
    );
    expect(onRecord?.value).toBe(partner?.id);
    expect(onRecord?.options.map((option) => option.label)).toContain(
      "Partner",
    );
    await expect(
      setValues("acme", { segment: "Partner" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("reorders the live fields, and refuses an order that leaves one out", async () => {
    const first = await addField({ label: "First" });
    const second = await addField({ label: "Second" });
    const archived = await addField({ label: "Archived" });
    await FieldsService.archive("org_a", archived.id);

    const reordered = await FieldsService.reorder("org_a", "COMPANY", [
      second.id,
      first.id,
    ]);

    expect(reordered.map((field) => field.key)).toEqual(["second", "first"]);
    await expect(
      FieldsService.reorder("org_a", "COMPANY", [second.id]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("counts coverage over live records, and every value it holds", async () => {
    await addCompanies("org_a", ["acme", "globex", "initech"]);
    await addCompanies("org_a", ["gone"], "2026-01-01T00:00:00.000Z");
    const field = await addField({ label: "Runs on" });
    await setValues("acme", { runs_on: "AWS" });
    await setValues("gone", { runs_on: "GCP" });

    expect(await FieldsService.coverage("org_a", field.id)).toEqual({
      filled: 1,
      total: 3,
      values: 2,
    });
  });

  it("deletes a field with every value it holds", async () => {
    await addCompanies("org_a", ["acme"]);
    const field = await addField({ label: "Runs on" });
    await setValues("acme", { runs_on: "AWS" });

    await FieldsService.remove("org_a", field.id);

    expect(await FieldsService.list("org_a", "COMPANY")).toEqual([]);
    expect(await database.rows("SELECT id FROM field_value")).toHaveLength(0);
  });

  it("keeps each organization's fields to itself", async () => {
    const field = await addField({ label: "Runs on" });

    expect(await FieldsService.list("org_b", "COMPANY")).toEqual([]);
    await expect(
      FieldsService.archive("org_b", field.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      FieldsService.update("org_b", { id: field.id, label: "Mine now" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(FieldsService.remove("org_b", field.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      FieldsService.coverage("org_b", field.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await addField({ label: "Runs on" }, "org_b")).toMatchObject({
      key: "runs_on",
    });
    expect(await FieldsService.list("org_a", "COMPANY")).toMatchObject([
      { id: field.id, label: "Runs on", archived: false },
    ]);
  });
});
