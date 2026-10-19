import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_ATTEMPTS, PRIORITY, RETIRED_OUTCOME } from "@/shared/agent-tasks";

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

import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { runResearchLane, runVisibleLane } from "./dispatch";
import { DISPATCH } from "./dispatch/config";
import { reconcileStaleTasks } from "./dispatch/staleTasks";
import type { LeasedTask } from "./repositories/AgentQueueRepository";
import { reportResearch } from "./runtime/research";
import { loadAgentSession } from "./runtime/session";
import { AgentTaskService } from "./services/AgentTaskService";
import { sessionName } from "./sessionName";
import { NO_CONTEXT_REASON } from "./visible/brand";

const defer = vi.fn();
const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();
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

  it("falls back on the company's own favicon, the largest it declares, kept with the organization's images", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (urlOf(input) === "https://acme.test/") {
        return new Response(
          '<link rel="icon" sizes="32x32" href="/icon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">',
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        init?.method === "HEAD" ? null : new Uint8Array([137, 80, 78, 71]),
        { headers: { "content-type": "image/png" } },
      );
    });
    await queue("t1", {
      kind: "brand",
      priority: PRIORITY.brand,
      companyId: "co1",
    });
    await runVisibleLane({ defer });
    const downloaded = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method !== "HEAD")
      .map(([input]) => urlOf(input));
    expect(downloaded).toEqual([
      "https://acme.test/",
      "https://acme.test/touch.png",
    ]);
    const [key] = r2.put.mock.calls[0] ?? [];
    expect(key).toMatch(/^org_a\/companies\/co1\/icon-[0-9a-f]{12}\.png$/);
    expect(await row("company", "co1")).toMatchObject({
      icon_url: `/api/images/${String(key)}`,
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

  it("lets another organization's research through a bulk enrich", async () => {
    const ids = Array.from({ length: 15 }, (_, index) => `bulk${index}`);
    await database.exec(
      ids
        .map(
          (id) =>
            `INSERT INTO company (id, organization_id, name, domain) VALUES ('${id}', 'org_a', '${id}', '${id}.test');`,
        )
        .join("\n"),
    );
    await database.exec(
      `INSERT INTO contact (id, organization_id, first_name, email) VALUES ('c_b', 'org_b', 'Bo', 'bo@bolt.test');`,
    );
    await CompanyService.bulkEnrich("org_a", ids);
    await AgentTaskService.contactCreated("org_b", "c_b", "New contact");

    const start = vi.fn(async (task: LeasedTask) => ({
      sessionId: `task.${task.id}`,
    }));
    await runResearchLane({
      start,
      modelConfigured: true,
      defer,
    });
    const started = start.mock.calls.map(([task]) => task.organizationId);
    expect(started.filter((id) => id === "org_b")).toHaveLength(1);
    expect(started.filter((id) => id === "org_a")).toHaveLength(
      DISPATCH.research.perOrganization,
    );
  });

  it("hands back research its model's provider failed, its attempt unused, to try later", async () => {
    await queue("t1", {
      kind: "identify",
      priority: PRIORITY.identify,
      contactId: "c1",
    });
    await runResearchLane({
      start: async () => ({ sessionId: "task.session" }),
      modelConfigured: true,
      defer,
    });
    const session = await loadAgentSession(sessionName("task", "org_a", "t1"));
    if (session?.kind !== "research") throw new Error("no research session");

    // Still the session's to carry on with, so it isn't cleared.
    expect(
      await reportResearch(session, {
        status: "error",
        error:
          "Failed after 3 attempts. Last error: Upstream provider request failed",
      }),
    ).toBe(false);
    const task = await row("agent_task", "t1");
    expect(task).toMatchObject({
      attempts: 0,
      leased_until: null,
      finished_at: null,
    });
    expect(Date.parse(z.string().parse(task?.due_at))).toBeGreaterThan(
      Date.now() + 4 * 60_000,
    );
    expect(await row("contact", "c1")).toMatchObject({
      enrichment_status: "PENDING",
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
