import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ASK_QUESTION, parseQuestion } from "@/shared/agent-question";

// What a conversation waits on the rep for, read from its last message: an
// open question (src/shared/agent-question.ts) or a step to approve. Only the connected
// thread reads messages, so this, and the AI SDK it needs, load with it.

type Part = UIMessage["parts"][number];

/** The tool call an assistant message is parked on, if it is the last one. */
function lastAssistantParts(messages: readonly UIMessage[]): Part[] {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.parts : [];
}

/**
 * The question the agent is waiting on: its `ask_question` call in the last
 * message, not yet answered. A question the conversation has moved past is
 * not pending.
 */
export function pendingQuestion(messages: readonly UIMessage[]) {
  for (const part of lastAssistantParts(messages)) {
    if (
      isToolUIPart(part) &&
      getToolName(part) === ASK_QUESTION &&
      part.state === "input-available"
    ) {
      return {
        toolCallId: part.toolCallId,
        question: parseQuestion(part.input),
      };
    }
  }
  return null;
}

/**
 * A tool call in the last message that waits for the rep to approve it
 * (`needsApproval`). Think replays it to a client that reconnects, so it is
 * read from the transcript like the question.
 */
export function pendingApproval(messages: readonly UIMessage[]) {
  for (const part of lastAssistantParts(messages)) {
    if (isToolUIPart(part) && part.state === "approval-requested") {
      return {
        approvalId: part.approval.id,
        tool: getToolName(part),
        input: part.input,
      };
    }
  }
  return null;
}
