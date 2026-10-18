import { beforeAll, describe, expect, it, vi } from "vitest";

// Team agents as AI clients work them: see one and its runs, run it, stop a
// run, pause it, delete it, through the SDK's tools endpoint on real SQL.
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
import { live } from "@/server/features/team-agents/services/teamAgentTestSupport";

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
});
