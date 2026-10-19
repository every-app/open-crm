import { beforeAll, describe, expect, it, vi } from "vitest";

// Team agents as AI clients work them: see one, its files, runs and audit
// log, run it, stop a run, rename, pause and delete it, through the SDK's
// tools endpoint on real SQL.
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
vi.mock("@/server/features/team-agents/runtime/poke", () => ({
  pokeEvents: vi.fn(),
  pokeRuns: vi.fn(),
}));

import {
  READ_WRITE,
  bo,
  call,
  failure,
  idFrom,
  type Caller,
} from "@/server/everyapp/toolTestSupport";
import {
  draft,
  live,
} from "@/server/features/team-agents/services/teamAgentTestSupport";

const member: Caller = {
  sub: "user_c",
  email: "cy@a.test",
  orgId: "org_a",
  orgRole: "member",
};

describe("team agent tools", () => {
  beforeAll(() => testDb.seedTwoOrganizations());

  it("reads an agent's version and runs, runs it, stops the run, pauses and deletes it", async () => {
    const { agentId } = await live();
    expect(await call("list_team_agents")).toMatchObject({
      total: 1,
      agents: [{ id: agentId, name: "Stage watcher", status: "LIVE" }],
    });
    expect(await call("get_team_agent", { agentId })).toMatchObject({
      status: "LIVE",
      canManage: true,
      currentVersion: {
        number: 1,
        readable: true,
        actions: [{ type: "run.summary" }],
      },
      reviewVersion: null,
      triggers: [{ type: "MANUAL", enabled: true }],
    });

    const runId = await idFrom("run_team_agent", { agentId });
    expect(await call("get_team_agent_runs", { agentId })).toMatchObject({
      runs: [{ id: runId, status: "QUEUED", trigger: "MANUAL", version: 1 }],
    });
    expect(await call("get_team_agent_run", { agentId, runId })).toMatchObject({
      id: runId,
      steps: [{ type: "run.queued", text: "Requested a manual run" }],
      totalSteps: 1,
      actions: [],
    });
    expect(
      await failure("get_team_agent_run", { agentId, runId }, { as: bo }),
    ).toBe("The requested record was not found.");
    expect(await call("cancel_team_agent_run", { agentId, runId })).toEqual({
      cancelled: true,
    });

    expect(
      await failure(
        "change_team_agent_status",
        { agentId, action: "pause" },
        { as: member },
      ),
    ).toBe("Only an owner or an admin can do that.");
    expect(
      await call("change_team_agent_status", { agentId, action: "pause" }),
    ).toMatchObject({ id: agentId, status: "PAUSED" });
    expect(await failure("run_team_agent", { agentId })).toBe(
      "This agent isn't live. Deploy it, or resume it, before it runs.",
    );

    await call(
      "delete_team_agent",
      { agentId },
      { scopes: [...READ_WRITE, "mcp:destructive"] },
    );
    expect(await call("list_team_agents")).toMatchObject({ total: 0 });
  });

  it("lists an agent's triggers; reads its grants, files, runs page by page and audit log, and renames it", async () => {
    const readOnly = { scopes: ["mcp:read"] };
    const instructions: unknown = expect.stringContaining("one-line summary");
    const aCursor: unknown = expect.any(String);
    // Slack connected and read a moment ago, with #sales to post to.
    const at = new Date().toISOString();
    await testDb.exec(`
      INSERT INTO slack_connection (id, organization_id, team_id, bot_token, bot_scopes, connected_at, synced_at) VALUES ('sc', 'org_a', 'T1', 'xoxb-test', 'chat:write', '${at}', '${at}');
      INSERT INTO slack_channel (id, organization_id, slack_channel_id, name, is_member) VALUES ('ch_1', 'org_a', 'C1', 'sales', 1);
    `);
    const { agentId } = await live(
      draft({
        triggers: [
          { type: "MANUAL", name: "By hand", summary: "When someone runs it" },
          {
            type: "EVENT",
            name: "Stage moves",
            summary: "When a deal changes stage",
            event: "deal.stage.changed",
          },
        ],
        integrations: ["slack"],
        actions: [
          { type: "run.summary", provider: "crm", summary: "Summarize" },
          {
            type: "crm.activity.create",
            provider: "crm",
            summary: "Note what moved",
            activityTypes: ["NOTE"],
          },
          {
            type: "slack.message.post",
            provider: "slack",
            summary: "Tell sales",
            destination: {
              kind: "channel",
              resolution: "chosen",
              id: "C1",
              label: "#sales",
            },
          },
        ],
      }),
    );
    const bothTriggers: unknown = expect.arrayContaining([
      expect.objectContaining({ type: "MANUAL", name: "By hand" }),
      expect.objectContaining({ type: "EVENT", name: "Stage moves" }),
    ]);
    expect(await call("list_team_agents", {}, readOnly)).toMatchObject({
      agents: [{ id: agentId, triggers: bothTriggers }],
    });
    expect(await call("get_team_agent", { agentId }, readOnly)).toMatchObject({
      currentVersion: {
        actions: [
          { type: "run.summary" },
          { type: "crm.activity.create", activityTypes: ["NOTE"] },
          {
            type: "slack.message.post",
            destination: { kind: "channel", id: "C1", label: "#sales" },
          },
        ],
      },
    });
    expect(
      await call("get_team_agent_files", { agentId }, readOnly),
    ).toMatchObject({
      files: [
        { path: "agent/README.md" },
        { path: "agent/instructions.md", content: instructions },
        { path: "agent/manifest.json" },
      ],
    });

    // Two runs, an hour apart, one a page.
    const older = await idFrom("run_team_agent", { agentId });
    await call("cancel_team_agent_run", { agentId, runId: older });
    await testDb.exec(
      `UPDATE agent_run SET created_at = '2026-10-01T09:00:00.000Z' WHERE id = '${older}'`,
    );
    const newer = await idFrom("run_team_agent", { agentId });
    const page = await call(
      "get_team_agent_runs",
      { agentId, limit: 1 },
      readOnly,
    );
    expect(page).toMatchObject({ runs: [{ id: newer }], nextCursor: aCursor });
    expect(
      await call("get_team_agent_runs", {
        agentId,
        limit: 1,
        cursor: page.nextCursor,
      }),
    ).toMatchObject({ runs: [{ id: older }], nextCursor: null });

    expect(
      await failure(
        "rename_team_agent",
        { agentId, name: "Deal digest" },
        { as: member },
      ),
    ).toBe("Only an owner or an admin can do that.");
    expect(
      await call("rename_team_agent", { agentId, name: "Deal digest" }),
    ).toEqual({
      id: agentId,
      name: "Deal digest",
      description: "Summarizes deals that move.",
      status: "LIVE",
    });
    expect(
      await call("list_team_agent_activity", { agentId, limit: 1 }, readOnly),
    ).toMatchObject({
      events: [
        {
          type: "agent.updated",
          actor: { type: "USER", name: "Ana" },
          before: { name: "Stage watcher" },
          after: { name: "Deal digest" },
        },
      ],
    });
    expect(
      await failure("list_team_agent_activity", { agentId }, { as: bo }),
    ).toBe("The requested record was not found.");
    // As long a name and description as the CRM allowed.
    const name = "N".repeat(120);
    const description = "D".repeat(500);
    expect(
      await call("rename_team_agent", { agentId, name, description }),
    ).toMatchObject({ name, description });
  });
});
