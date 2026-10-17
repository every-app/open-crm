import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentConversation } from "@/db/schema";

// A person's conversations with the agent about one record. The messages live
// in the conversation's CrmAgent Durable Object (named by `session_id`); these
// rows are the handles lists and badges need. Every read is scoped to the
// organization, and to the person whose conversation it is: two people asking
// about the same contact are having two conversations.

export type RecordColumn = "contactId" | "companyId" | "dealId";

const summaryColumns = {
  id: agentConversation.id,
  sessionId: agentConversation.sessionId,
  title: agentConversation.title,
  messageCount: agentConversation.messageCount,
  createdAt: agentConversation.createdAt,
  lastMessageAt: agentConversation.lastMessageAt,
  lastAssistantAt: agentConversation.lastAssistantAt,
  lastReadAt: agentConversation.lastReadAt,
};

async function create(input: {
  organizationId: string;
  userId: string;
  column: RecordColumn;
  recordId: string;
  sessionId: string;
}) {
  const [row] = await db
    .insert(agentConversation)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      kind: "RECORD",
      userId: input.userId,
      sessionId: input.sessionId,
      contactId: input.column === "contactId" ? input.recordId : null,
      companyId: input.column === "companyId" ? input.recordId : null,
      dealId: input.column === "dealId" ? input.recordId : null,
    })
    .returning(summaryColumns);
  if (!row) throw new Error("Conversation row missing after insert");
  return row;
}

/** The person's conversations about a record, most recent first. */
async function listForRecord(
  organizationId: string,
  userId: string,
  column: RecordColumn,
  recordId: string,
  limit = 20,
) {
  return db
    .select(summaryColumns)
    .from(agentConversation)
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.userId, userId),
        eq(agentConversation.kind, "RECORD"),
        eq(agentConversation[column], recordId),
      ),
    )
    .orderBy(desc(agentConversation.lastMessageAt), desc(agentConversation.id))
    .limit(limit);
}

/** One of the person's conversations about a record, by id. */
async function findForRecord(
  organizationId: string,
  userId: string,
  column: RecordColumn,
  recordId: string,
  id: string,
) {
  const [row] = await db
    .select(summaryColumns)
    .from(agentConversation)
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.userId, userId),
        eq(agentConversation.id, id),
        eq(agentConversation[column], recordId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The conversation a session (its Durable Object's name) belongs to: who owns
 * it and which record it is about.
 */
async function findBySession(organizationId: string, sessionId: string) {
  const [row] = await db
    .select({
      id: agentConversation.id,
      userId: agentConversation.userId,
      title: agentConversation.title,
      contactId: agentConversation.contactId,
      companyId: agentConversation.companyId,
      dealId: agentConversation.dealId,
    })
    .from(agentConversation)
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.sessionId, sessionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The person read the conversation now. False when it isn't theirs. */
async function markRead(
  organizationId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const updated = await db
    .update(agentConversation)
    .set({ lastReadAt: new Date().toISOString() })
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.userId, userId),
        eq(agentConversation.id, id),
      ),
    )
    .returning({ id: agentConversation.id });
  return updated.length > 0;
}

/**
 * Deletes one of the person's record conversations, and with it the steps the
 * agent took there (agent_event cascades). The removed row's session, or null
 * when it isn't theirs.
 */
async function remove(
  organizationId: string,
  userId: string,
  id: string,
): Promise<{ id: string; sessionId: string } | null> {
  const [row] = await db
    .delete(agentConversation)
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.userId, userId),
        eq(agentConversation.kind, "RECORD"),
        eq(agentConversation.id, id),
      ),
    )
    .returning({
      id: agentConversation.id,
      sessionId: agentConversation.sessionId,
    });
  return row ?? null;
}

/** A message went into the conversation (`assistant`: the agent's reply). */
async function recordMessage(
  organizationId: string,
  id: string,
  input: { messageCount: number; assistant: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(agentConversation)
    .set({
      messageCount: input.messageCount,
      lastMessageAt: now,
      updatedAt: now,
      ...(input.assistant ? { lastAssistantAt: now } : {}),
    })
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.id, id),
      ),
    );
}

/**
 * Titles the conversation unless it already has a title. The title it ends up
 * with, or null when the conversation is gone.
 */
async function setTitleIfEmpty(
  organizationId: string,
  id: string,
  title: string,
): Promise<{ saved: boolean; title: string | null } | null> {
  const [saved] = await db
    .update(agentConversation)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.id, id),
        isNull(agentConversation.title),
      ),
    )
    .returning({ title: agentConversation.title });
  if (saved) return { saved: true, title: saved.title };
  const [current] = await db
    .select({ title: agentConversation.title })
    .from(agentConversation)
    .where(
      and(
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.id, id),
      ),
    )
    .limit(1);
  return current ? { saved: false, title: current.title } : null;
}

export const AgentConversationRepository = {
  create,
  listForRecord,
  findForRecord,
  findBySession,
  markRead,
  remove,
  recordMessage,
  setTitleIfEmpty,
};
