import { beforeEach, describe, expect, it, vi } from "vitest";

// The list tools' facet counts name values as the tools' filters take them.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);

import { toolFacetCounts } from "@/server/everyapp/tools/facetCounts";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { createFieldSchema } from "@/types/schemas/fields";

describe("the list tools' facet counts", () => {
  beforeEach(async () => {
    await testDb.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await testDb.seedTwoOrganizations();
  });

  it("name members by email and options by label, leaving out what no filter takes", async () => {
    const field = (input: object) =>
      FieldsService.create(
        "org_a",
        createFieldSchema.parse({
          entity: "COMPANY",
          agentFilled: false,
          ...input,
        }),
      );
    const tier = await field({
      label: "Tier",
      type: "SELECT",
      options: [{ label: "Gold" }],
    });
    await field({ label: "Champion", type: "USER" });
    const [gold] = tier.options.map((option) => option.id);

    expect(
      await toolFacetCounts("org_a", "COMPANY", {
        // user_b works for the other organization.
        owner: { user_a: 2, unassigned: 1, user_b: 4 },
        industry: { Software: 2 },
        "field:tier": { [gold]: 2, retired_option: 1 },
        "field:champion": { user_a: 1 },
      }),
    ).toEqual({
      owner: { "ana@a.test": 2, unassigned: 1 },
      industry: { Software: 2 },
      "field:tier": { Gold: 2 },
      "field:champion": { "ana@a.test": 1 },
    });
  });
});
