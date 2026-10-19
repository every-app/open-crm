import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildProgress, builderStep } from "./builderSteps";

describe("builder steps", () => {
  it("reads a call that failed before or while it ran as failed with its error, and counts nothing it refused as written or saved", () => {
    const invalidWrite = {
      type: "tool-write_agent_file",
      toolCallId: "call_0",
      state: "output-error",
      input: undefined,
      rawInput: { path: "agent/instructions.md" },
      errorText: "Invalid input for tool write_agent_file: content is missing.",
    } as const;
    const refusedWrite = {
      type: "tool-write_agent_file",
      toolCallId: "call_1",
      state: "output-available",
      input: { path: "agent/instructions.md", content: "api_key: sk_live" },
      output: {
        error: "Agent files cannot contain credentials or secret values.",
      },
    } as const;
    const refusedSave = {
      type: "tool-save_agent_draft",
      toolCallId: "call_2",
      state: "output-available",
      input: { name: "Monday digest" },
      output: { error: "The agent builder exceeded its draft-save budget." },
    } as const;
    const reply: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [invalidWrite, refusedWrite, refusedSave],
    };

    expect(builderStep(invalidWrite, true)).toEqual({
      label:
        "Could not write instructions — Invalid input for tool write_agent_file: content is missing.",
      tone: "warning",
      sources: [],
    });
    expect(builderStep(refusedWrite, false)).toMatchObject({
      label:
        "Could not write instructions — Agent files cannot contain credentials or secret values.",
      tone: "warning",
    });
    expect(builderStep(refusedSave, false)).toMatchObject({
      label:
        "Could not save draft · Monday digest — The agent builder exceeded its draft-save budget.",
      tone: "warning",
    });
    expect(buildProgress([reply])).toEqual({
      written: new Set(),
      writing: null,
    });
  });
});
