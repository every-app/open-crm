import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

// One research session end to end, with a stubbed model and no network: the
// dispatcher leases the task the workspace's website queued, the session
// builds its prompt and tools from the database (as CrmAgent.beforeTurn does),
// the model calls a tool that writes, and the session reports back to the
// queue (as CrmAgent.onSubmissionStatus does).
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => database.runBatchModule);
vi.mock("@/server/lib/provider-access", () => ({
  getContextFetch: vi.fn(async () => null),
  hasContextAccess: vi.fn(async () => false),
}));

import { runResearchLane } from "./dispatch";
import { capabilityList } from "./prompt/capabilities";
import type { LeasedTask } from "./repositories/AgentQueueRepository";
import { recordEvent } from "./runtime/audit";
import { researchBrief } from "./runtime/brief";
import { budgetSpender } from "./runtime/budget";
import { reportResearch } from "./runtime/research";
import { loadAgentSession } from "./runtime/session";
import { MAX_STEPS, prepareTurn } from "./runtime/turn";
import { AgentTaskService } from "./services/AgentTaskService";
import { sessionName } from "./sessionName";

const NARRATIVE =
  "Acme sells compliance automation to startups that need a SOC 2 audit, billed per seat each year.";

function model() {
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  return new MockLanguageModelV3({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "write_workspace_profile",
            input: JSON.stringify({
              narrative: NARRATIVE,
              sells: "Compliance automation",
              sellsTo: "Startups facing a SOC 2 audit",
            }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Wrote our profile from acme.test." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

/** What CrmAgent does with a task, inline: start, run the turn, report back. */
async function runSession(task: LeasedTask, stub: MockLanguageModelV3) {
  const sessionId = sessionName("task", task.organizationId, task.id);
  const session = await loadAgentSession(sessionId);
  if (session?.kind !== "research") throw new Error("no research session");
  const { system, tools } = await prepareTurn(session, {
    thinkSystem: "",
    capabilities: capabilityList({
      context: false,
      webResearch: true,
      pictures: true,
      githubToken: false,
    }),
    spend: budgetSpender(
      { spent: 0, budget: session.task.budget, exhausted: false },
      () => {},
    ),
    role: null,
  });
  const result = await generateText({
    model: stub,
    system,
    prompt: researchBrief(session.task, task.attempts),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    onStepFinish: (step) =>
      recordEvent(session, "step.completed", {
        finishReason: step.finishReason,
      }),
  });
  await reportResearch(session, { status: "completed", text: result.text });
  return { sessionId };
}

describe("a research session", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM agent_event; DELETE FROM agent_task; DELETE FROM workspace_profile; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO workspace (organization_id, name, website) VALUES ('org_a', 'Acme', 'acme.test'), ('org_b', 'Bolt', 'bolt.test');`,
    );
  });

  it("works the task a new website queued, writes what it found, and finishes the task", async () => {
    await AgentTaskService.workspaceChanged(
      "org_a",
      "acme.test",
      "The company using this CRM said what its website is",
    );
    const stub = model();
    const started = await runResearchLane({
      start: (task) => runSession(task, stub),
      modelAvailable: () => true,
      askedForOnly: true,
      defer: vi.fn(),
    });
    expect(started).toBe(1);

    // The model was briefed on our own business, by this organization's data.
    const [firstCall] = stub.doGenerateCalls;
    expect(JSON.stringify(firstCall?.prompt)).toContain(
      "You are writing the profile of **the company you work for** — Acme (acme.test)",
    );

    const [task] = await database.rows("SELECT * FROM agent_task");
    const taskId = typeof task?.id === "string" ? task.id : "";
    const sessionId = sessionName("task", "org_a", taskId);
    expect(task).toMatchObject({
      kind: "workspace-profile",
      outcome: "Wrote our profile from acme.test.",
      session_id: sessionId,
    });
    expect(task?.finished_at).toBeTruthy();

    expect(await database.rows("SELECT * FROM workspace_profile")).toEqual([
      expect.objectContaining({
        organization_id: "org_a",
        website: "acme.test",
        narrative: NARRATIVE,
        session_id: sessionId,
      }),
    ]);

    const events = await database.rows(
      "SELECT organization_id, session_id, type FROM agent_event",
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["step.completed", "task.finished"]),
    );
    expect(events.every((event) => event.organization_id === "org_a")).toBe(
      true,
    );
  });
});
