import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIORITY } from "@/shared/agent-tasks";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { database, r2 } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    r2: { put: vi.fn<(key: string, value: unknown) => Promise<void>>() },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", R2: r2 },
}));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => database.runBatchModule);
// Logos aren't fetched at once here: the lanes under test take them.
vi.mock("./poke", () => ({ pokeDispatcher: vi.fn() }));
// No Context.dev key on this install.
vi.mock("@/server/lib/provider-access", () => ({
  getContextFetch: vi.fn(async () => null),
  hasContextAccess: vi.fn(async () => false),
}));
// The first-party deployment, which bills.
const { autumn } = await vi.hoisted(async () => ({
  autumn: (await import("@/server/billing/autumnTestSupport")).autumnMock(),
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn,
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { withBalance } from "@/server/billing/autumnTestSupport";
import { laneCreditCheck } from "@/server/billing/credits";
import {
  getContextFetch,
  hasContextAccess,
} from "@/server/lib/provider-access";
import { runResearchLane, runVisibleLane } from "./dispatch";

const defer = vi.fn();
const past = (ms = 1000) => new Date(Date.now() - ms).toISOString();

async function queue(
  id: string,
  fields: {
    kind: string;
    priority: number;
    companyId?: string;
    contactId?: string;
  },
  extra = "",
) {
  await database.exec(
    `INSERT INTO agent_task (id, organization_id, kind, reason, priority, budget, due_at, company_id, contact_id, subject${extra ? ", attempts, leased_until, started_at" : ""})
     VALUES ('${id}', 'org_a', '${fields.kind}', 'test', ${fields.priority}, 4, '${past()}',
             ${fields.companyId ? `'${fields.companyId}'` : "NULL"},
             ${fields.contactId ? `'${fields.contactId}'` : "NULL"}, 'subject-${id}'${extra})`,
  );
}

async function row(table: string, id: string) {
  const [found] = await database.rows(
    `SELECT * FROM ${table} WHERE id = '${id}'`,
  );
  return found;
}

describe("the dispatcher's credits", () => {
  beforeEach(async () => {
    withBalance(autumn, 500);
    // Company sites (favicons) answer nothing unless a test says otherwise.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await database.exec(
      `DELETE FROM agent_task; DELETE FROM contact; DELETE FROM company; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('co1', 'org_a', 'Acme', 'acme.test');
       INSERT INTO contact (id, organization_id, first_name, email) VALUES ('c1', 'org_a', 'Ana', 'ana@acme.test');`,
    );
  });

  it("holds an organization's research while it is out of credits, and leases it once it has some", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    const start = vi.fn(async () => ({ sessionId: "task.session" }));
    const tick = () =>
      runResearchLane({
        start,
        modelConfigured: true,
        askedForOnly: false,
        defer,
        credits: laneCreditCheck({}),
      });

    withBalance(autumn, 0);
    expect(await tick()).toBe(0);
    expect(start).not.toHaveBeenCalled();
    expect(await row("agent_task", "t1")).toMatchObject({
      attempts: 0,
      leased_until: null,
    });
    // Confirmed out lately: the next tick holds it without asking Autumn.
    autumn.check.mockClear();
    expect(await tick()).toBe(0);
    expect(autumn.check).not.toHaveBeenCalled();

    // The hold lapses; Autumn now shows credits.
    await database.exec(
      `UPDATE workspace SET credits_depleted_at = '${past(60 * 60_000)}'`,
    );
    withBalance(autumn, 500);
    expect(await tick()).toBe(1);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", attempts: 1 }),
    );
  });

  it("admits an organization's research task by task against one reading, three sessions at a time", async () => {
    for (const id of ["t1", "t2", "t3", "t4"]) {
      await queue(id, {
        kind: "identify",
        priority: PRIORITY.identify,
        contactId: "c1",
      });
    }
    const start = vi.fn(async (task: { id: string }) => ({
      sessionId: `task.${task.id}`,
    }));
    const tick = () =>
      runResearchLane({
        start,
        modelConfigured: true,
        askedForOnly: false,
        defer,
        credits: laneCreditCheck({}),
      });
    const waiting = () =>
      database.rows(
        `SELECT id FROM agent_task WHERE leased_until IS NULL AND attempts = 0`,
      );

    // One reading of 500 credits covers two sessions of 192.
    withBalance(autumn, 500);
    expect(await tick()).toBe(2);
    expect(autumn.check).toHaveBeenCalledTimes(2);
    expect(await waiting()).toHaveLength(2);

    // Credits to spare: a third session starts, and the fourth waits for one
    // of the three to end.
    withBalance(autumn, 50_000);
    expect(await tick()).toBe(1);
    expect(await waiting()).toHaveLength(1);
    expect(await database.rows(`SELECT * FROM paid_session`)).toHaveLength(3);
  });

  it("bills a logo lookup's Context.dev call at its reported credits", async () => {
    await queue("t1", {
      kind: "brand",
      priority: PRIORITY.brand,
      companyId: "co1",
    });
    vi.mocked(hasContextAccess).mockResolvedValueOnce(true);
    vi.mocked(getContextFetch).mockResolvedValueOnce(async () =>
      Response.json({
        brand: { title: "Acme" },
        key_metadata: { credits_consumed: 10, credits_remaining: 990 },
      }),
    );

    expect(await runVisibleLane({ defer })).toBe(1);
    // 10 credits at $0.0025 is $0.025, $0.032 with the markup.
    expect(autumn.track.mock.calls.map(([request]) => request)).toMatchObject([
      {
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: 32,
        overageBehavior: "overflow",
        properties: {
          app: "open-crm",
          provider: "context",
          operation: "brand/retrieve",
          creditFeature: "company_data",
          taskId: "t1",
        },
      },
    ]);
  });
});
