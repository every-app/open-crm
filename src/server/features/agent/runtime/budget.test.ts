import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addTokens, spentChatReply, tokenLimitStep } from "./budget";
import type { AgentSession } from "./session";

// A session's token limits, applied as CrmAgent applies them: each step's
// usage is added once it finishes (onStepFinish) and checked before the next
// model call (beforeStep), so the call that crosses a limit finishes, as the
// CRM's runtime let it.

/** A session's own storage, as CrmAgent's ctx.storage.kv. */
function sessionStorage() {
  const stored = new Map<string, unknown>();
  return {
    get: (key: string) => stored.get(key),
    put: (key: string, value: unknown) => void stored.set(key, value),
  };
}

type Storage = ReturnType<typeof sessionStorage>;

/** A step's usage: `input` tokens read, 5 written. */
function usageOf(input: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
}

/** A model whose first step reads `input` tokens and calls a tool, then answers. */
function model(input: number) {
  return new MockLanguageModelV3({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "look",
            input: "{}",
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: usageOf(input),
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Here is what I have." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usageOf(10),
        warnings: [],
      },
    ],
  });
}

const tools: ToolSet = {
  look: tool({ inputSchema: z.object({}), execute: async () => "Seen." }),
};

/** A turn of a session of `kind`, as CrmAgent runs it. */
function turn(
  storage: Storage,
  stub: MockLanguageModelV3,
  kind: AgentSession["kind"],
) {
  const system = "Answer.";
  return generateText({
    model: stub,
    system,
    prompt: "Who else should we talk to?",
    tools,
    stopWhen: stepCountIs(5),
    prepareStep: () => tokenLimitStep(storage, { kind, system }),
    onStepFinish: (step) => addTokens(storage, step.usage),
  });
}

const toolsOf = (stub: MockLanguageModelV3, call: number) =>
  stub.doGenerateCalls[call]?.tools ?? [];

describe("a session's token limits", () => {
  it("count a chat's tokens across its turns: past 500,000 it writes up with no tools, then answers a new message with a notice", async () => {
    const storage = sessionStorage();
    const first = model(300_000);
    await turn(storage, first, "chat");
    expect(toolsOf(first, 1)).not.toEqual([]);
    expect(spentChatReply(storage, "RECORD")).toBeNull();

    const second = model(250_000);
    await turn(storage, second, "chat");
    expect(toolsOf(second, 1)).toEqual([]);
    expect(JSON.stringify(second.doGenerateCalls[1]?.prompt)).toContain(
      "The token budget for this session is spent.",
    );
    expect(spentChatReply(storage, "RECORD")).toBe(
      "This conversation has hit its token limit. Start a new conversation.",
    );
  });

  it("fail a run's next model call past its 500,000 input tokens, in the CRM's words", async () => {
    const storage = sessionStorage();
    const run = model(600_000);
    await expect(turn(storage, run, "run")).rejects.toThrow(
      "The session reached its configured input token limit.",
    );
    expect(run.doGenerateCalls).toHaveLength(1);
  });
});
