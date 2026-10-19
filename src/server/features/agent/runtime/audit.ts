import type { StepContext } from "@cloudflare/think";
import type { UIMessage } from "ai";
import { AgentRunRepository } from "@/server/features/team-agents/repositories/AgentRunRepository";
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

/**
 * A finished step: its event, and on a team agent's run, its tokens and cost
 * for the runs drawer.
 */
export async function recordStep(
  session: AgentSession,
  step: StepContext,
  costUsd: number,
): Promise<void> {
  await recordEvent(session, "step.completed", {
    stepNumber: step.stepNumber,
    finishReason: step.finishReason,
    inputTokens: step.usage.inputTokens ?? null,
    outputTokens: step.usage.outputTokens ?? null,
    costUsd,
  });
  if (session.kind !== "run") return;
  await AgentRunRepository.addUsage(session.organizationId, session.run.id, {
    inputTokens: step.usage.inputTokens ?? 0,
    outputTokens: step.usage.outputTokens ?? 0,
    costUsd,
  });
}

/** A message's visible text: its text parts, without reasoning or tools. */
export function messageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function lastFrom(
  messages: readonly UIMessage[],
  role: UIMessage["role"],
): UIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return message;
  }
  return undefined;
}

/** The text of the last message from `role`. */
export function lastText(
  messages: readonly UIMessage[],
  role: UIMessage["role"],
): string {
  return messageText(lastFrom(messages, role));
}

/**
 * What the agent said once its work was done: the text of the last step of
 * its last reply, without the narration between earlier tool calls.
 */
export function finalText(messages: readonly UIMessage[]): string {
  const message = lastFrom(messages, "assistant");
  if (!message) return "";
  const lastStep = message.parts
    .map((part) => part.type)
    .lastIndexOf("step-start");
  return messageText({ ...message, parts: message.parts.slice(lastStep + 1) });
}
