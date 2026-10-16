import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agentConversation, agentEvent } from "@/db/schema";
import type { RecordColumn } from "./AgentConversationRepository";

// The agent's audit trail: what it did, step by step, filed against the
// session and the record it was working on. The Agent tab reads it back.

type NewAgentEvent = {
  organizationId: string;
  sessionId: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  conversationId: string | null;
  type: string;
  data: unknown;
};

async function insert(event: NewAgentEvent): Promise<void> {
  await db.insert(agentEvent).values({
    id: crypto.randomUUID(),
    ...event,
    emittedAt: new Date().toISOString(),
  });
}

/**
 * What the agent did about a record, newest first: its research sessions, and
 * the person's own conversations about it. Another person's conversation
 * about the same record stays theirs.
 */
async function listForRecord(
  organizationId: string,
  userId: string,
  column: RecordColumn,
  recordId: string,
  limit: number,
) {
  return db
    .select({
      id: agentEvent.id,
      sessionId: agentEvent.sessionId,
      conversationId: agentEvent.conversationId,
      type: agentEvent.type,
      data: agentEvent.data,
      emittedAt: agentEvent.emittedAt,
    })
    .from(agentEvent)
    .leftJoin(
      agentConversation,
      and(
        eq(agentConversation.id, agentEvent.conversationId),
        eq(agentConversation.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(agentEvent.organizationId, organizationId),
        eq(agentEvent[column], recordId),
        or(
          isNull(agentEvent.conversationId),
          eq(agentConversation.userId, userId),
        ),
      ),
    )
    .orderBy(desc(agentEvent.emittedAt), desc(agentEvent.id))
    .limit(limit);
}

/** A session's events in order (the research transcript, for the audit). */
async function listForSession(organizationId: string, sessionId: string) {
  return db
    .select({
      type: agentEvent.type,
      data: agentEvent.data,
      emittedAt: agentEvent.emittedAt,
    })
    .from(agentEvent)
    .where(
      and(
        eq(agentEvent.organizationId, organizationId),
        eq(agentEvent.sessionId, sessionId),
      ),
    )
    .orderBy(agentEvent.emittedAt, agentEvent.id);
}

export const AgentEventRepository = {
  insert,
  listForRecord,
  listForSession,
};
