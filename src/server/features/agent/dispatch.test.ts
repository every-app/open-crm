import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, PRIORITY, RETIRED_OUTCOME } from "@/shared/agent-tasks";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => database.runBatchModule);
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
import { reconcileStaleTasks } from "./dispatch/staleTasks";
import { NO_CONTEXT_REASON } from "./visible/brand";

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

describe("the dispatcher", () => {
  beforeEach(async () => {
    withBalance(autumn, 500);
    await database.exec(
      `DELETE FROM agent_task; DELETE FROM contact; DELETE FROM company; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('co1', 'org_a', 'Acme', 'acme.test');
       INSERT INTO contact (id, organization_id, first_name, email) VALUES ('c1', 'org_a', 'Ana', 'ana@acme.test');`,
    );
  });

  it("finishes a brand task with nowhere to look, and leaves the company for later", async () => {
    await queue("t1", {
      kind: "brand",
      priority: PRIORITY.brand,
      companyId: "co1",
    });
    expect(await runVisibleLane({ defer })).toBe(1);
    expect(await row("agent_task", "t1")).toMatchObject({
      outcome: NO_CONTEXT_REASON,
    });
    expect((await row("agent_task", "t1"))?.finished_at).toBeTruthy();
    expect(await row("company", "co1")).toMatchObject({
      enrichment_status: "PENDING",
    });
  });

  it("starts a session for each research task and records it", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    const start = vi.fn(async () => ({ sessionId: "task.session" }));
    const started = await runResearchLane({
      start,
      modelConfigured: true,
      askedForOnly: false,
      defer,
    });
    expect(started).toBe(1);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        organizationId: "org_a",
        attempts: 1,
      }),
    );
    expect(await row("agent_task", "t1")).toMatchObject({
      session_id: "task.session",
    });
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "RUNNING",
    });
  });

  it("leaves research waiting, its attempts untouched, when there is no model", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    const start = vi.fn(async () => ({ sessionId: "unused" }));
    await runResearchLane({
      start,
      modelConfigured: false,
      askedForOnly: false,
      defer,
    });
    expect(start).not.toHaveBeenCalled();
    expect(await row("agent_task", "t1")).toMatchObject({
      finished_at: null,
      attempts: 0,
    });
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "PENDING",
    });
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

  it("fails the record when its session does not start, and keeps the task for a retry", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    await runResearchLane({
      start: async () => {
        throw new Error("Durable Object unavailable");
      },
      modelConfigured: true,
      askedForOnly: false,
      defer,
    });
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "FAILED",
      enrichment_error: "Durable Object unavailable",
    });
    expect((await row("agent_task", "t1"))?.finished_at).toBeNull();
  });

  it("retires a task that never reported back, and fails its record", async () => {
    await database.exec(
      `UPDATE contact SET enrichment_status = 'RUNNING' WHERE id = 'c1'`,
    );
    await queue(
      "t1",
      { kind: "identify", priority: PRIORITY.identify, contactId: "c1" },
      `, ${MAX_ATTEMPTS}, '${past()}', '${past(60_000)}'`,
    );
    await queue(
      "t2",
      {
        kind: "company-profile",
        priority: PRIORITY.companyProfile,
        companyId: "co1",
      },
      `, 1, '${past()}', '${past(60_000)}'`,
    );
    const sweep = await reconcileStaleTasks();
    expect(sweep).toMatchObject({ retired: 1, released: 1, error: null });
    expect(await row("agent_task", "t1")).toMatchObject({
      outcome: RETIRED_OUTCOME,
    });
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "FAILED",
      enrichment_error:
        "Research was attempted several times and never completed.",
    });
    // A dead lease with attempts left goes back to waiting.
    expect(await row("agent_task", "t2")).toMatchObject({
      leased_until: null,
      finished_at: null,
    });
  });
});
