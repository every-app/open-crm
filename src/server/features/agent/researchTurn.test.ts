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
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: database.db,
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
import { addTokens, budgetSpender, tokenLimitStep } from "./runtime/budget";
import { reportResearch } from "./runtime/research";
import { loadAgentSession } from "./runtime/session";
import { MAX_STEPS, prepareTurn } from "./runtime/turn";
import { AgentTaskService } from "./services/AgentTaskService";
import { sessionName } from "./sessionName";

const NARRATIVE =
  "Acme sells compliance automation to startups that need a SOC 2 audit, billed per seat each year.";

/** A step's usage: `input` tokens read, 5 written. */
function usageOf(input: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
}

function model() {
  const usage = usageOf(10);
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
  // The session's own storage, where CrmAgent keeps its tokens.
  const stored = new Map<string, unknown>();
  const storage = {
    get: (key: string) => stored.get(key),
    put: (key: string, value: unknown) => void stored.set(key, value),
  };
  const result = await generateText({
    model: stub,
    system,
    prompt: researchBrief(session.task, task.attempts),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // CrmAgent.beforeStep: past its tokens, the session writes up.
    prepareStep: () => tokenLimitStep(storage, { kind: "research", system }),
    onStepFinish: (step) => {
      addTokens(storage, "research", step.usage);
      return recordEvent(session, "step.completed", {
        finishReason: step.finishReason,
      });
    },
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
      modelConfigured: true,
      defer: vi.fn(),
    });
    expect(started).toBe(1);

    // The model was briefed on our own business, by this organization's data,
    // and could search the web as the CRM's agent could, when the site
    // doesn't say who the customer is.
    const [firstCall] = stub.doGenerateCalls;
    expect(JSON.stringify(firstCall?.prompt)).toContain(
      "You are writing the profile of **the company you work for** — Acme (acme.test)",
    );
    expect(JSON.stringify(firstCall?.prompt)).toContain(
      "search the web only if the site does not say who",
    );
    expect(firstCall?.tools).toContainEqual(
      expect.objectContaining({ type: "provider", name: "web_search" }),
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

  it("writes up what it has once its tokens are spent, with no more tools", async () => {
    await AgentTaskService.workspaceChanged(
      "org_a",
      "acme.test",
      "The company using this CRM said what its website is",
    );
    const stub = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search_crm",
              input: JSON.stringify({ query: "acme" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          // More than a session's 500,000 tokens.
          usage: usageOf(600_000),
          warnings: [],
        },
        {
          content: [
            { type: "text", text: "Acme sells robots. Unread: pricing." },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage: usageOf(10),
          warnings: [],
        },
      ],
    });
    await runResearchLane({
      start: (task) => runSession(task, stub),
      modelConfigured: true,
      defer: vi.fn(),
    });

    const [first, last] = stub.doGenerateCalls;
    expect(first?.tools?.length).toBeGreaterThan(0);
    expect(last?.tools ?? []).toEqual([]);
    expect(JSON.stringify(last?.prompt)).toContain(
      "The token budget for this session is spent.",
    );
    const [task] = await database.rows("SELECT * FROM agent_task");
    expect(task).toMatchObject({
      outcome: "Acme sells robots. Unread: pricing.",
    });
    expect(task?.finished_at).toBeTruthy();
  });
});
