import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { RunSideEffects } from "@/server/features/team-agents/runtime/runSideEffects";
import { AgentActionRepository } from "@/server/features/team-agents/repositories/AgentActionRepository";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// What a run may do is the deployed version's grants, enforced by the tools
// themselves on both backends: no activity type it wasn't granted, no record
// outside its scope, Slack only to its one pinned destination, and every side
// effect once per tool call however often the call is replayed.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.modules.workers.env,
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import type { AgentManifest } from "@/shared/team-agents";
import { FREE } from "@/server/features/agent/runtime/budget";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { RunActions } from "./runActions";
import { runnerTools } from "./runnerTools";

const ORG = "org_a";

const summary = {
  type: "run.summary",
  provider: "crm",
  summary: "Summarize",
} as const;

const manifest = (overrides: Partial<AgentManifest> = {}): AgentManifest => ({
  name: "Agent",
  description: "Does a thing.",
  triggers: [{ type: "MANUAL", name: "By hand", summary: "By hand" }],
  dataScope: { mode: "WORKSPACE", summary: "Workspace", resources: [] },
  actions: [summary],
  access: [],
  ...overrides,
});

/** A deployed version of `value` with one RUNNING run: the run's id. */
async function runningRun(value: AgentManifest): Promise<string> {
  const agentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await AgentVersionRepository.saveVersion({
    agent: {
      id: agentId,
      organizationId: ORG,
      name: value.name,
      description: value.description,
      createdById: "user_a",
      conversationId: null,
    },
    version: {
      id: versionId,
      organizationId: ORG,
      agentId,
      number: 1,
      status: "READY",
      instructions: "Do the thing.",
      manifest: value,
      modelId: "model",
      sourceConversationId: null,
      createdById: "user_a",
    },
    triggers: [],
    artifacts: [],
    claimedArtifactIds: [],
    audit: [],
  });
  await AgentVersionRepository.deploy({
    organizationId: ORG,
    agentId,
    versionId,
    name: value.name,
    description: null,
    audit: {
      organizationId: ORG,
      agentId,
      actorType: "USER",
      type: "agent.deployed",
      summary: "Deployed",
      requestId: crypto.randomUUID(),
    },
  });
  const run = await AgentRunRepository.insertIfAbsent({
    organizationId: ORG,
    agentId,
    versionId,
    triggerId: null,
    initiatedById: "user_a",
    triggerType: "MANUAL",
    idempotencyKey: crypto.randomUUID(),
    input: null,
  });
  await AgentRunRepository.claim(ORG, run.id, "model");
  return run.id;
}

const countRow = z.object({ n: z.coerce.number() });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`run actions (${dialect})`, () => {
    const database = testDb.use(dialect);
    const count = async (sql: string) =>
      countRow.parse((await database.rows(sql))[0]).n;

    beforeEach(async () => {
      testDb.use(dialect);
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
        sessionId: "s",
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

      const posted = await RunSideEffects.postSlackMessage(
        ORG,
        runId,
        "call_1",
        {
          text: "Three deals slipped",
        },
      );
      const replay = await RunSideEffects.postSlackMessage(
        ORG,
        runId,
        "call_1",
        {
          text: "Three deals slipped",
        },
      );
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
}
