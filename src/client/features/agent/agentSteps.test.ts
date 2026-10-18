import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { agentRuns } from "./agentLog";
import { describeStep } from "./agentSteps";
import { pendingApproval, pendingQuestion } from "./agentTranscript";

describe("describeStep", () => {
  it("says why a lead was turned down, with the page it read", () => {
    expect(
      describeStep("set_contact_socials", {
        output: {
          stored: false,
          reason: "the profile lists another address",
          profileUrl: "https://github.com/lewis",
          url: "javascript:alert(1)",
        },
      }),
    ).toEqual({
      label: "Checked a profile — the profile lists another address",
      tone: "warning",
      sources: [
        {
          url: "https://github.com/lewis",
          title: "github.com",
          network: "github",
        },
      ],
    });
  });

  it("says a source the install lacks isn't set up, not what it tells the model", () => {
    expect(
      describeStep("research_person", {
        output: {
          configured: false,
          reason: "This install has no web research. Retrying will not help.",
        },
      }),
    ).toMatchObject({
      label: "Researched them on the web — not set up here",
      tone: "neutral",
    });
  });

  it("tones a write as done, and a tool that threw as a warning with its error", () => {
    expect(describeStep("write_brief", { output: { written: true } })).toEqual({
      label: "Wrote the background",
      tone: "success",
      sources: [],
    });
    expect(
      describeStep("enrich_company", {
        output: { error: "Context.dev is down" },
      }),
    ).toMatchObject({
      label: "Looked up the company — Context.dev is down",
      tone: "warning",
    });
  });
});

const assistant = (parts: UIMessage["parts"]): UIMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  parts,
});

describe("pendingQuestion", () => {
  const asked = assistant([
    {
      type: "tool-ask_question",
      toolCallId: "call_1",
      state: "input-available",
      input: {
        prompt: "Two Marchettis work at Fernhill. Which one?",
        options: [{ label: "Paula Marchetti", description: "Head of Sales" }],
      },
    },
  ]);

  it("finds the question the agent is waiting on", () => {
    expect(pendingQuestion([asked])).toEqual({
      toolCallId: "call_1",
      question: {
        prompt: "Two Marchettis work at Fernhill. Which one?",
        options: [{ label: "Paula Marchetti", description: "Head of Sales" }],
      },
    });
  });

  it("ignores a question that was answered, or that the conversation moved past", () => {
    const answered = assistant([
      {
        type: "tool-ask_question",
        toolCallId: "call_1",
        state: "output-available",
        input: { prompt: "Which one?" },
        output: { answer: "Paula Marchetti" },
      },
    ]);
    const later: UIMessage = {
      id: "m2",
      role: "user",
      parts: [{ type: "text", text: "Never mind." }],
    };
    expect(pendingQuestion([answered])).toBeNull();
    expect(pendingQuestion([asked, later])).toBeNull();
  });
});

describe("pendingApproval", () => {
  it("finds a step waiting on the rep, and not once they answered", () => {
    const part = {
      type: "tool-record_job_change",
      toolCallId: "call_2",
      input: { contactId: "c1" },
    } as const;
    expect(
      pendingApproval([
        assistant([
          { ...part, state: "approval-requested", approval: { id: "ap_1" } },
        ]),
      ]),
    ).toEqual({
      approvalId: "ap_1",
      tool: "record_job_change",
      input: { contactId: "c1" },
    });
    expect(
      pendingApproval([
        assistant([
          {
            ...part,
            state: "output-denied",
            approval: { id: "ap_1", approved: false },
          },
        ]),
      ]),
    ).toBeNull();
  });
});

const event = (id: string, sessionId: string, type: string, data: unknown) => ({
  id,
  sessionId,
  conversationId: null,
  type,
  data,
  emittedAt: `2026-10-16T00:00:0${id}.000Z`,
});

describe("agentRuns", () => {
  it("groups the record's events by run, newest run first, steps in order", () => {
    const runs = agentRuns([
      event("4", "task.b", "task.finished", { outcome: "Found her." }),
      event("3", "task.b", "step.completed", { inputTokens: 900 }),
      event("2", "task.b", "tool.completed", { toolName: "web_fetch" }),
      event("1", "task.a", "tool.failed", {
        toolName: "web_fetch",
        error: "404",
      }),
    ]);
    expect(
      runs.map((run) => [run.sessionId, run.entries.map((e) => e.label)]),
    ).toEqual([
      ["task.b", ["Read a web page", "Finished"]],
      ["task.a", ["Read a web page — 404"]],
    ]);
  });
});
