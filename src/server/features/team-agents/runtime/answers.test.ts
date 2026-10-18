import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { checkedSocketMessage } from "./answers";

// An answer to the agent's open question as it comes over a chat's socket:
// the server takes an option the question offers, named by its label, or
// typed text where the question takes it, and only while the question is
// open. Every other message passes as it came.

const question = {
  prompt: "Which channel?",
  options: [{ id: "C1", label: "#sales" }],
};

function asked(input: object, answered = false): UIMessage[] {
  return [
    {
      id: "a1",
      role: "assistant",
      parts: answered
        ? [
            {
              type: "tool-ask_question",
              toolCallId: "q1",
              state: "output-available",
              input,
              output: { optionId: "C1", answer: "#sales" },
            },
          ]
        : [
            {
              type: "tool-ask_question",
              toolCallId: "q1",
              state: "input-available",
              input,
            },
          ],
    },
  ];
}

const answer = (output: object) =>
  JSON.stringify({
    type: "cf_agent_tool_result",
    toolCallId: "q1",
    toolName: "ask_question",
    output,
    autoContinue: true,
  });

const forwarded = (message: string | null): unknown =>
  message === null ? null : JSON.parse(message);

describe("an answer to the agent's question", () => {
  it("names the option chosen, takes typed text where the question takes it, and passes other messages", () => {
    const transcript = asked({ ...question, allowFreeform: true });
    expect(
      forwarded(
        checkedSocketMessage(
          answer({ optionId: "C1", answer: "#general" }),
          transcript,
        ),
      ),
    ).toEqual({
      type: "cf_agent_tool_result",
      toolCallId: "q1",
      toolName: "ask_question",
      output: { optionId: "C1", answer: "#sales" },
      autoContinue: true,
    });
    expect(
      forwarded(
        checkedSocketMessage(answer({ answer: " Neither " }), transcript),
      ),
    ).toMatchObject({ output: { answer: "Neither" } });

    const request = JSON.stringify({ type: "cf_agent_use_chat_request" });
    expect(checkedSocketMessage(request, transcript)).toBe(request);
  });

  it("refuses an option the question doesn't offer, text it doesn't take, and a second answer", () => {
    const transcript = asked(question);
    expect(
      checkedSocketMessage(answer({ optionId: "C9" }), transcript),
    ).toBeNull();
    expect(
      checkedSocketMessage(answer({ answer: "#general" }), transcript),
    ).toBeNull();
    expect(
      checkedSocketMessage(answer({ optionId: "C1" }), asked(question, true)),
    ).toBeNull();
  });
});
