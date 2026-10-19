import type { ToolSet } from "ai";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { MEMBER_ROLES } from "@/types/schemas/members";
import type { Capability } from "../prompt/capabilities";
import {
  CHAT_TITLE_INSTRUCTION,
  RESEARCH_INSTRUCTIONS,
  RUNTIME_INSTRUCTIONS,
} from "../prompt/instructions";
import { sessionPreamble, type Opened } from "../prompt/preamble";
import type { Egress } from "../tools/egress";
import { buildAgentTools } from "../tools/registry";
import type { Spend } from "./budget";
import { fieldKeysOf } from "./brief";
import type { AgentSession, ChatSession } from "./session";

// One turn's system prompt and tools, built fresh from the session each turn
// (CrmAgent.beforeTurn): the standing instructions, the session's preamble
// (its record, who opened it, what the install has), then Think's own block
// (the skills catalog). The tools are bound to the session's organization.

export const MAX_STEPS = 24;

/**
 * A step's output tokens. A person's chat turn reasons at "max", and the
 * budget is shared by that reasoning and the visible reply, so it stays well
 * above what reasoning uses (OpenSEO's SAM limit): a tight cap lets
 * reasoning eat the reply. Background work reasons at "low".
 */
export function maxOutputTokens(kind: AgentSession["kind"]): number {
  return kind === "chat" ? 16_000 : 8_000;
}

/** Owner, admin, member; any other name ranks below a member. */
function rank(role: string): number {
  const index = MEMBER_ROLES.findIndex((name) => name === role);
  return index === -1 ? MEMBER_ROLES.length : index;
}

/**
 * A chat's person's role for this turn: `connected`, the role their socket
 * connected with, lowered to the member mirror's once the gateway has signed
 * a lower one onto any request of theirs since, and none once the mirror no
 * longer has them. Read every turn, so a demotion applies from the turn
 * after the person's next request through the gateway (the app refetches
 * after every reply), not when the socket next reconnects.
 */
async function turnRole(
  session: ChatSession,
  connected: string | null,
): Promise<string | null> {
  if (!connected) return null;
  const members = await AuthRepository.listMembers(session.organizationId);
  const mirrored = members.find(
    (member) => member.userId === session.conversation.userId,
  )?.role;
  if (!mirrored) return null;
  return rank(mirrored) > rank(connected) ? mirrored : connected;
}

export async function prepareTurn(
  session: AgentSession,
  input: {
    /** Think's assembled system prompt for the turn: the skills catalog. */
    thinkSystem: string;
    capabilities: readonly Capability[];
    spend: Spend;
    /**
     * The gateway role the chat's person connected with (CrmAgent.onConnect),
     * checked against the member mirror each turn (turnRole).
     */
    role: string | null;
    /**
     * What a research session has read that decides where its web_fetch may
     * go, from its own storage (tools/egress.ts). Without it, it reads no
     * pages.
     */
    egress?: Egress;
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
    role: session.kind === "chat" ? await turnRole(session, input.role) : null,
    spend: input.spend,
    egress: input.egress,
  });
  return { system, tools };
}
