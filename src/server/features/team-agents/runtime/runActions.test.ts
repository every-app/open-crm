import { RunSideEffects } from "@/server/features/team-agents/runtime/runSideEffects";
import { AgentActionRepository } from "@/server/features/team-agents/repositories/AgentActionRepository";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// What a run may do is the deployed version's grants, enforced by the tools
// themselves: no activity type it wasn't granted, no record
// outside its scope, Slack only to its one pinned destination, and every side
// effect once per tool call however often the call is replayed.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { FREE } from "@/server/features/agent/runtime/budget";
import { RunActions } from "./runActions";
import { runnerTools } from "./runnerTools";
import { manifest, ORG, runningRun, summary } from "./runTestSupport";

const countRow = z.object({ n: z.coerce.number() });

describe("run actions", () => {
  const count = async (sql: string) =>
    countRow.parse((await database.rows(sql))[0]).n;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'acme', 'user_a');
      `);
  });

  it("creates no activity the version didn't grant", async () => {
    const runId = await runningRun(manifest());
    const tools = runnerTools({
      organizationId: ORG,
      runId,
      manifest: manifest(),
      spend: FREE,
    });
    expect(Object.keys(tools)).not.toContain("create_crm_activity");
    expect(Object.keys(tools)).not.toContain("post_slack_message");
    await expect(
      RunSideEffects.createActivity(ORG, runId, "call_1", {
        type: "NOTE",
        targetKind: "deal",
        targetId: "renewal",
        body: "Hello",
      }),
    ).rejects.toThrow("does not allow CRM note activities");
    expect(await count("SELECT count(*) AS n FROM activity")).toBe(0);
  });

  it("reads and writes only inside the selected scope", async () => {
    const scoped = manifest({
      dataScope: {
        mode: "SELECTED",
        summary: "Renewal",
        resources: [{ kind: "deal", id: "renewal", label: "Renewal" }],
      },
      actions: [
        summary,
        {
          type: "crm.activity.create",
          provider: "crm",
          summary: "Notes",
          activityTypes: ["NOTE"],
        },
      ],
    });
    const runId = await runningRun(scoped);
    await expect(
      RunActions.readRecord(ORG, runId, { kind: "company", id: "acme" }),
    ).rejects.toThrow("outside this agent version's approved scope");
    await expect(
      RunSideEffects.createActivity(ORG, runId, "call_1", {
        type: "NOTE",
        targetKind: "company",
        targetId: "acme",
        body: "Hello",
      }),
    ).rejects.toThrow("outside this agent version's approved scope");
    const search = await RunActions.queryCrm(ORG, runId, {
      query: "Acme",
      limit: 10,
    });
    expect(search.companies).toEqual([]);
    expect(search.deals.map((deal) => deal.id)).toEqual(["renewal"]);
    expect(
      await RunActions.readRecord(ORG, runId, {
        kind: "deal",
        id: "renewal",
      }),
    ).toMatchObject({ found: true, deal: { name: "Renewal" } });
  });

  it("writes a granted note once per tool call", async () => {
    const runId = await runningRun(
      manifest({
        actions: [
          summary,
          {
            type: "crm.activity.create",
            provider: "crm",
            summary: "Notes",
            activityTypes: ["NOTE"],
          },
        ],
      }),
    );
    const note = {
      type: "NOTE" as const,
      targetKind: "deal" as const,
      targetId: "renewal",
      body: "Slipped a week",
    };
    const first = await RunSideEffects.createActivity(
      ORG,
      runId,
      "call_1",
      note,
    );
    const replay = await RunSideEffects.createActivity(
      ORG,
      runId,
      "call_1",
      note,
    );
    expect(first).toMatchObject({ replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      RunSideEffects.createActivity(ORG, runId, "call_1", {
        ...note,
        body: "Other",
      }),
    ).rejects.toThrow("already used for other input");
    expect(
      await count(
        "SELECT count(*) AS n FROM activity WHERE deal_id = 'renewal' AND company_id = 'acme'",
      ),
    ).toBe(1);
    const [action] = await AgentActionRepository.actionsForRuns(ORG, [runId]);
    expect(action).toMatchObject({ status: "SUCCEEDED", attemptCount: 1 });
  });

  it("posts to Slack only at the approved destination, once per call", async () => {
    await database.exec(`
        INSERT INTO slack_connection (id, organization_id, team_id, bot_token, bot_scopes)
          VALUES ('sc', 'org_a', 'T1', 'xoxb-test-token', 'chat:write');
      `);
    const runId = await runningRun(
      manifest({
        dataScope: {
          mode: "WORKSPACE",
          summary: "Workspace",
          resources: [
            { kind: "integration", id: "slack:workspace", label: "Slack" },
          ],
        },
        actions: [
          summary,
          {
            type: "slack.message.post",
            provider: "slack",
            summary: "Post",
            destination: {
              kind: "channel",
              resolution: "chosen",
              id: "C_SALES",
              label: "#sales",
            },
          },
        ],
      }),
    );
    const fetch = vi.fn(async (_url: URL, _init?: RequestInit) =>
      Response.json({ ok: true, channel: "C_SALES", ts: "1700000000.1" }),
    );
    vi.stubGlobal("fetch", fetch);

    const posted = await RunSideEffects.postSlackMessage(ORG, runId, "call_1", {
      text: "Three deals slipped",
    });
    const replay = await RunSideEffects.postSlackMessage(ORG, runId, "call_1", {
      text: "Three deals slipped",
    });
    expect(posted).toMatchObject({
      destination: "#sales",
      messageId: "C_SALES:1700000000.1",
      replayed: false,
    });
    expect(replay).toMatchObject({ replayed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://slack.com/api/chat.postMessage");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer xoxb-test-token",
    );
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    ).toMatchObject({
      channel: "C_SALES",
      text: "Three deals slipped",
    });
  });

  it("refuses Slack to a version that doesn't name the integration", async () => {
    const runId = await runningRun(
      manifest({
        actions: [
          summary,
          {
            type: "slack.message.post",
            provider: "slack",
            summary: "Post",
            destination: {
              kind: "channel",
              resolution: "chosen",
              id: "C1",
              label: "#x",
            },
          },
        ],
      }),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      RunSideEffects.postSlackMessage(ORG, runId, "call_1", { text: "Hi" }),
    ).rejects.toThrow("does not allow Slack");
    expect(fetch).not.toHaveBeenCalled();
  });
});
