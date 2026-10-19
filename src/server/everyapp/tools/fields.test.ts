import { reverse } from "remeda";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The custom field tools, and the custom field values a record's create and
// update take, end to end below the gateway on real SQL.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", DEPLOYMENT_TIER: "fork" },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));
vi.mock("@/server/features/team-agents/runtime/poke", () => ({
  pokeEvents: vi.fn(),
  pokeRuns: vi.fn(),
}));

import {
  ana,
  bo,
  call,
  failure,
  idFrom,
  type Caller,
} from "@/server/everyapp/toolTestSupport";

const member: Caller = {
  sub: "user_c",
  email: "cy@a.test",
  orgId: "org_a",
  orgRole: "member",
};

beforeAll(() => testDb.seedTwoOrganizations());

describe("custom field tools", () => {
  it("custom fields: owners and admins define them, anyone sets values, selects go by label and people by email", async () => {
    const segment = {
      entity: "COMPANY",
      label: "Segment",
      type: "SELECT",
      options: [{ label: "Enterprise" }, { label: "SMB" }],
      agentFilled: false,
      showOnTable: true,
    };
    expect(await failure("create_field", segment, { as: member })).toBe(
      "Only an owner or an admin can do that.",
    );
    await call("create_field", segment);
    await call("create_field", {
      entity: "COMPANY",
      label: "Account manager",
      type: "USER",
      agentFilled: false,
      showOnTable: true,
    });
    const id = await idFrom("create_company", { name: "Hooli" });
    expect(
      await call(
        "set_field_values",
        {
          entity: "COMPANY",
          recordId: id,
          values: { segment: "Enterprise", account_manager: ana.email },
        },
        { as: member },
      ),
    ).toMatchObject({
      fields: [
        { key: "segment" },
        { key: "account_manager", value: ana.email },
      ],
    });
    expect(await call("get_company", { id })).toMatchObject({
      fields: { segment: "Enterprise", account_manager: ana.email },
    });
    const { fields } = await call("list_fields", { entity: "COMPANY" });
    const { total } = await call("list_companies");
    expect(
      await call("get_field_coverage", {
        id: z.array(z.object({ id: z.string() })).parse(fields)[0]?.id,
      }),
    ).toEqual({ filled: 1, total });
    expect(
      await call("list_companies", {
        fields: { segment: { op: "anyOf", values: ["enterprise"] } },
      }),
    ).toMatchObject({
      total: 1,
      companies: [
        {
          id,
          fields: { segment: "Enterprise", account_manager: ana.email },
        },
      ],
    });

    const order = reverse(
      z
        .array(z.object({ id: z.string() }))
        .parse(fields)
        .map((field) => field.id),
    );
    expect(
      await failure(
        "reorder_fields",
        { entity: "COMPANY", ids: order },
        { as: member },
      ),
    ).toBe("Only an owner or an admin can do that.");
    expect(
      await call("reorder_fields", { entity: "COMPANY", ids: order }),
    ).toMatchObject({
      fields: [
        { key: "account_manager", showOnSheet: true, showOnFilter: false },
        { key: "segment" },
      ],
    });
  });

  it("a record's create and update take custom field values and write them with the record, all or nothing: people by email as set_field_values takes them, never onto another organization's record", async () => {
    for (const entity of ["COMPANY", "CONTACT", "DEAL"]) {
      await call("create_field", {
        entity,
        label: "Champion",
        type: "USER",
        agentFilled: false,
      });
    }
    // A member's first call makes them one of the CRM's members.
    const companyId = await idFrom(
      "create_company",
      {
        name: "Pied Piper",
        domain: "piedpiper.test",
        fields: { champion: ana.email },
      },
      { as: member },
    );
    const records = [
      ["company", companyId],
      [
        "contact",
        await idFrom("create_contact", {
          firstName: "Richard",
          companyId,
          fields: { champion: ana.email },
        }),
      ],
      [
        "deal",
        await idFrom("create_deal", {
          name: "Compression",
          companyId,
          fields: { champion: ana.email },
        }),
      ],
    ] as const;
    for (const [kind, id] of records) {
      expect(await call(`get_${kind}`, { id })).toMatchObject({
        fields: { champion: ana.email },
      });
      await call(`update_${kind}`, { id, fields: { champion: member.email } });
      expect(await call(`get_${kind}`, { id })).toMatchObject({
        fields: { champion: member.email },
      });
    }

    // A change that fails writes none of its values.
    await idFrom("create_company", { name: "Raviga", domain: "raviga.test" });
    expect(
      await failure("update_company", {
        id: companyId,
        domain: "raviga.test",
        fields: { champion: ana.email },
      }),
    ).toBe("Another company already uses that domain.");
    expect(await call("get_company", { id: companyId })).toMatchObject({
      domain: "piedpiper.test",
      fields: { champion: member.email },
    });

    // Another organization's company, though it has a field of that key.
    await call(
      "create_field",
      {
        entity: "COMPANY",
        label: "Champion",
        type: "USER",
        agentFilled: false,
      },
      { as: bo },
    );
    expect(
      await failure(
        "update_company",
        { id: companyId, fields: { champion: bo.email } },
        { as: bo },
      ),
    ).toBe(`No company with id ${companyId}.`);
    expect(
      await testDb.rows(
        `SELECT id FROM field_value WHERE organization_id = 'org_b'`,
      ),
    ).toEqual([]);
  });

  it("a value given at creation isn't queued for the research agent to find", async () => {
    await call("create_field", {
      entity: "COMPANY",
      label: "Founded",
      type: "NUMBER",
    });
    const given = await idFrom("create_company", {
      name: "Endframe",
      fields: { founded: 2014 },
    });
    const blank = await idFrom("create_company", { name: "Nucleus" });
    expect(
      await testDb.rows(
        `SELECT company_id FROM agent_task WHERE kind = 'field-backfill' AND company_id IN ('${given}', '${blank}')`,
      ),
    ).toEqual([{ company_id: blank }]);
  });
});
