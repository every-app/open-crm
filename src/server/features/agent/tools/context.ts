import type { ToolSet } from "ai";
import type { RecordIds } from "../prompt/preamble";
import type { Spend } from "../runtime/budget";

/**
 * What every tool knows about the session it runs in. The registry builds a
 * fresh set of tools per turn from it (registry.ts), so a tool never takes an
 * organization, a session or a budget from the model.
 */
export type AgentToolContext = {
  organizationId: string;
  /** The session's id: its CrmAgent's name, filed on what it writes. */
  sessionId: string;
  /** The record the session is about. */
  record: RecordIds;
  /** The dispatcher's task, for a research session. */
  task: { id: string; kind: string } | null;
  /** The person's conversation, for a chat. */
  conversation: { id: string; needsTitle: boolean } | null;
  /** A person is in the conversation, waiting on the reply. */
  attended: boolean;
  /**
   * That person's gateway role, as the gateway signed it when their chat
   * connected (agentRoutes.ts); null with nobody there. Gates the tools only
   * an owner or admin may use.
   */
  role: string | null;
  /** Draws on the session's research budget; vendor calls cost 2. */
  spend: Spend;
};

/** A family of tools, built for one session's turn. */
export type ToolGroup = (context: AgentToolContext) => ToolSet;
