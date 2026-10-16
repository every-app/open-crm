import type { ToolSet } from "ai";
import type { Capability } from "../prompt/capabilities";
import {
  CHAT_TITLE_INSTRUCTION,
  RESEARCH_INSTRUCTIONS,
  RUNTIME_INSTRUCTIONS,
} from "../prompt/instructions";
import { sessionPreamble, type Opened } from "../prompt/preamble";
import { buildAgentTools } from "../tools/registry";
import type { Spend } from "./budget";
import { fieldKeysOf } from "./brief";
import type { AgentSession } from "./session";

// One turn's system prompt and tools, built fresh from the session each turn
// (CrmAgent.beforeTurn): the standing instructions, the session's preamble
// (its record, who opened it, what the install has), then Think's own block
// (the skills catalog). The tools are bound to the session's organization.

export const MAX_STEPS = 24;
export const MAX_OUTPUT_TOKENS = 8_000;

export async function prepareTurn(
  session: AgentSession,
  input: {
    /** Think's assembled system prompt for the turn: the skills catalog. */
    thinkSystem: string;
    capabilities: readonly Capability[];
    spend: Spend;
  },
): Promise<{ system: string; tools: ToolSet }> {
  const opened: Opened =
    session.kind === "research"
      ? {
          dispatched: true,
          kind: session.task.kind,
          reason: session.task.reason,
          budget: session.task.budget,
          fieldKeys: fieldKeysOf(session.task),
        }
      : { dispatched: false };
  const preamble = await sessionPreamble(
    session.organizationId,
    session.record,
    opened,
    input.capabilities,
  );
  const needsTitle = session.kind === "chat" && !session.conversation.title;
  const system = [
    RUNTIME_INSTRUCTIONS,
    RESEARCH_INSTRUCTIONS,
    needsTitle ? CHAT_TITLE_INSTRUCTION : "",
    preamble,
    input.thinkSystem,
  ]
    .filter(Boolean)
    .join("\n\n");
  const tools = buildAgentTools({
    organizationId: session.organizationId,
    sessionId: session.sessionId,
    record: session.record,
    task: session.task
      ? { id: session.task.id, kind: session.task.kind }
      : null,
    conversation: session.conversation
      ? { id: session.conversation.id, needsTitle }
      : null,
    attended: session.kind === "chat",
    spend: input.spend,
  });
  return { system, tools };
}
