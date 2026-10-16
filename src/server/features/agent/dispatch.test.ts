import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, PRIORITY, RETIRED_OUTCOME } from "@/shared/agent-tasks";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => ({ runBatch: database.runBatch }));
// No Context.dev key on this install.
vi.mock("@/server/lib/provider-access", () => ({
  getContextFetch: vi.fn(async () => null),
  hasContextAccess: vi.fn(async () => false),
}));

import {
  MODEL_UNAVAILABLE_OUTCOME,
  runResearchLane,
  runVisibleLane,
} from "./dispatch";
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
      modelAvailable: () => true,
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

  it("says so once when the model is unavailable, rather than failing three times", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    const start = vi.fn(async () => ({ sessionId: "unused" }));
    await runResearchLane({
      start,
      modelAvailable: () => false,
      askedForOnly: false,
      defer,
    });
    expect(start).not.toHaveBeenCalled();
    expect(await row("agent_task", "t1")).toMatchObject({
      outcome: MODEL_UNAVAILABLE_OUTCOME,
    });
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "PENDING",
    });
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
      modelAvailable: () => true,
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
