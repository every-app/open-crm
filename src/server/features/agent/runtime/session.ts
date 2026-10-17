import { AgentRunRepository } from "@/server/features/team-agents/repositories/AgentRunRepository";
import { AgentConversationRepository } from "../repositories/AgentConversationRepository";
import { AgentTaskRepository } from "../repositories/AgentTaskRepository";
import type { RecordIds } from "../prompt/preamble";
import { parseSessionName } from "../sessionName";

// What a CrmAgent is working on, read from its own name (sessionName.ts) and
// the row the name points at: the dispatcher's task, a person's conversation
// (about a record, or with the agent builder), or a team agent's run. The
// organization is always the name's, and every lookup is scoped to it.

export type ResearchSession = {
  kind: "research";
  sessionId: string;
  organizationId: string;
  record: RecordIds;
  task: {
    id: string;
    kind: string;
    reason: string;
    payload: unknown;
    budget: number;
    attempts: number;
  };
  conversation: null;
};

export type ChatSession = {
  kind: "chat";
  sessionId: string;
  organizationId: string;
  record: RecordIds;
  task: null;
  conversation: {
    id: string;
    userId: string;
    title: string | null;
    /** RECORD (a record's Agent tab) or BUILDER (the agent builder). */
    kind: "RECORD" | "BUILDER";
  };
};

/** A team agent's run (src/server/features/team-agents). */
export type RunSession = {
  kind: "run";
  sessionId: string;
  organizationId: string;
  record: RecordIds;
  task: null;
  conversation: null;
  run: { id: string; agentId: string; versionId: string };
};

export type AgentSession = ResearchSession | ChatSession | RunSession;

/** The session a CrmAgent's name stands for; null when its row is gone. */
export async function loadAgentSession(
  sessionId: string,
): Promise<AgentSession | null> {
  const name = parseSessionName(sessionId);
  if (!name) return null;
  const { organizationId } = name;
  if (name.kind === "task") {
    const task = await AgentTaskRepository.findById(organizationId, name.id);
    if (!task) return null;
    return {
      kind: "research",
      sessionId,
      organizationId,
      record: {
        contactId: task.contactId,
        companyId: task.companyId,
        dealId: task.dealId,
      },
      task: {
        id: task.id,
        kind: task.kind,
        reason: task.reason,
        payload: task.payload,
        budget: task.budget,
        attempts: task.attempts,
      },
      conversation: null,
    };
  }
  if (name.kind === "run") {
    const run = await AgentRunRepository.findById(organizationId, name.id);
    if (!run) return null;
    return {
      kind: "run",
      sessionId,
      organizationId,
      record: { contactId: null, companyId: null, dealId: null },
      task: null,
      conversation: null,
      run: { id: run.id, agentId: run.agentId, versionId: run.versionId },
    };
  }
  const conversation = await AgentConversationRepository.findBySession(
    organizationId,
    sessionId,
  );
  if (!conversation) return null;
  return {
    kind: "chat",
    sessionId,
    organizationId,
    record: {
      contactId: conversation.contactId,
      companyId: conversation.companyId,
      dealId: conversation.dealId,
    },
    task: null,
    conversation: {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      kind: conversation.kind,
    },
  };
}
