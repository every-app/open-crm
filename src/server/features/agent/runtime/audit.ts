import type { UIMessage } from "ai";
import { AgentEventRepository } from "../repositories/AgentEventRepository";
import type { AgentSession } from "./session";
import { capToolOutput } from "./toolOutput";

// The audit hook, ported from the CRM's hooks/audit.ts: every step of a
// session is an agent_event row (its session, the record it was about, the
// conversation if a person was in it), which the Agent tab reads back. A
// write that fails is logged and the turn goes on: the audit never breaks the
// work it records.

const MAX_EVENT_CHARS = 16_000;

export async function recordEvent(
  session: AgentSession,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await AgentEventRepository.insert({
      organizationId: session.organizationId,
      sessionId: session.sessionId,
      contactId: session.record.contactId,
      companyId: session.record.companyId,
      dealId: session.record.dealId,
      conversationId: session.conversation?.id ?? null,
      type,
      data: capToolOutput(data, MAX_EVENT_CHARS),
    });
  } catch (error) {
    console.warn("[agent] could not record event", {
      type,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A message's visible text: its text parts, without reasoning or tools. */
export function messageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/** The text of the last message from `role`. */
export function lastText(
  messages: readonly UIMessage[],
  role: UIMessage["role"],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return messageText(message);
  }
  return "";
}
