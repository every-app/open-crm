import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildProgress, builderStep } from "./builderSteps";

describe("builder steps", () => {
  it("reads a call that threw as failed with its error, and counts nothing it refused as written or saved", () => {
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
      parts: [refusedWrite, refusedSave],
    };

    expect(builderStep(refusedWrite, false)).toEqual({
      label:
        "Writing instructions — Agent files cannot contain credentials or secret values.",
      tone: "warning",
      sources: [],
    });
    expect(builderStep(refusedSave, false)).toMatchObject({
      label:
        "Saving draft · Monday digest — The agent builder exceeded its draft-save budget.",
      tone: "warning",
    });
    expect(buildProgress([reply])).toEqual({
      written: new Set(),
      writing: null,
    });
  });
});
