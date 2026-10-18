import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import {
  ASK_QUESTION,
  checkAnswer,
  parseQuestion,
} from "@/shared/agent-question";

// A person's answer to the agent's open question comes over the chat's socket
// as the chat client's tool result for `ask_question`, and Think would take
// whatever it carries. The CRM's server took only an answer the question
// offers, and only once (conversations.service.ts), so CrmAgent hands every
// socket message here before Think sees it, in a record chat and a builder
// chat alike.

const toolResult = z.looseObject({
  type: z.literal("cf_agent_tool_result"),
  toolCallId: z.string(),
  output: z.unknown(),
});

/** The question asked by the call `toolCallId` in the transcript, if any. */
function askedBy(transcript: readonly UIMessage[], toolCallId: string) {
  for (const message of transcript) {
    for (const part of message.parts) {
      if (isToolUIPart(part) && part.toolCallId === toolCallId) {
        return getToolName(part) === ASK_QUESTION ? part : null;
      }
    }
  }
  return null;
}

/**
 * The socket message to hand on to Think: an answer to the open question
 * with the option it chose named, or any other message as it came. Null
 * refuses an answer the question doesn't offer, or a second answer.
 */
export function checkedSocketMessage<Message>(
  message: Message,
  transcript: readonly UIMessage[],
): Message | string | null {
  if (typeof message !== "string") return message;
  let data: unknown;
  try {
    data = JSON.parse(message);
  } catch {
    return message;
  }
  const result = toolResult.safeParse(data);
  if (!result.success) return message;
  // Only an answer to a question the transcript holds is checked: any other
  // tool result, or one for a reply still streaming (where no question is
  // shown to answer), is Think's to settle.
  const asked = askedBy(transcript, result.data.toolCallId);
  if (!asked) return message;
  if (asked.state !== "input-available") return null;
  const answer = checkAnswer(parseQuestion(asked.input), result.data.output);
  if (!answer) return null;
  const { state: _state, errorText: _errorText, ...rest } = result.data;
  return JSON.stringify({ ...rest, output: answer });
}
