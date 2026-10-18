import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  agentConversation,
  agentConversationAttachment,
  agentConversationFeedback,
  agentDefinition,
  company,
  contact,
  deal,
} from "@/db/schema";
import type { RecordRef } from "@/shared/records";

// Builder chats: a person's private conversations with the agent builder
// (agent_conversation rows of kind BUILDER; the messages live in the chat's
// CrmAgent Durable Object), the feedback they leave on its replies and the
// files they attach. Every read is the organization's and the person's own.

const ID_CHUNK = 90;

const conversationColumns = () => ({
  id: agentConversation.id,
  sessionId: agentConversation.sessionId,
  title: agentConversation.title,
  messageCount: agentConversation.messageCount,
  createdAt: agentConversation.createdAt,
  lastMessageAt: agentConversation.lastMessageAt,
  lastAssistantAt: agentConversation.lastAssistantAt,
  lastReadAt: agentConversation.lastReadAt,
  agentId: agentDefinition.id,
  agentName: agentDefinition.name,
  agentStatus: agentDefinition.status,
});

type NewAttachment = {
  id: string;
  organizationId: string;
  conversationId: string;
  userId: string;
  name: string;
  mediaType: string;
  size: number;
  storageKey: string;
};

/**
 * A builder chat, with the files its first message attaches, in one batch:
 * the chat never exists without them. `id` is the client's, for a retry to
 * find.
 */
async function createConversation(input: {
  id?: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  attachments?: NewAttachment[];
}): Promise<{ id: string; sessionId: string }> {
  const id = input.id ?? crypto.randomUUID();
  const attachments = input.attachments ?? [];
  await runBatch((tx) => [
    tx.insert(agentConversation).values({
      id,
      organizationId: input.organizationId,
      kind: "BUILDER",
      userId: input.userId,
      sessionId: input.sessionId,
      lastReadAt: new Date().toISOString(),
    }),
    ...(attachments.length > 0
      ? [tx.insert(agentConversationAttachment).values(attachments)]
      : []),
  ]);
  return { id, sessionId: input.sessionId };
}

function ownBuilderChats(organizationId: string, userId: string) {
  return and(
    eq(agentConversation.organizationId, organizationId),
    eq(agentConversation.userId, userId),
    eq(agentConversation.kind, "BUILDER"),
  );
}

/** The person's builder chats, latest first, with the agent each made. */
async function listConversations(organizationId: string, userId: string) {
  return db
    .select(conversationColumns())
    .from(agentConversation)
    .leftJoin(
      agentDefinition,
      and(
        eq(agentDefinition.conversationId, agentConversation.id),
        eq(agentDefinition.organizationId, organizationId),
      ),
    )
    .where(ownBuilderChats(organizationId, userId))
    .orderBy(desc(agentConversation.lastMessageAt), desc(agentConversation.id))
    .limit(50);
}

async function findConversation(
  organizationId: string,
  userId: string,
  id: string,
) {
  const [row] = await db
    .select(conversationColumns())
    .from(agentConversation)
    .leftJoin(
      agentDefinition,
      and(
        eq(agentDefinition.conversationId, agentConversation.id),
        eq(agentDefinition.organizationId, organizationId),
      ),
    )
    .where(
      and(
        ownBuilderChats(organizationId, userId),
        eq(agentConversation.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Deletes one of the person's builder chats; its session, or null. */
async function removeConversation(
  organizationId: string,
  userId: string,
  id: string,
): Promise<{ id: string; sessionId: string } | null> {
  const [row] = await db
    .delete(agentConversation)
    .where(
      and(
        ownBuilderChats(organizationId, userId),
        eq(agentConversation.id, id),
      ),
    )
    .returning({
      id: agentConversation.id,
      sessionId: agentConversation.sessionId,
    });
  return row ?? null;
}

export type DescribedRecord = RecordRef & {
  label: string;
  detail: string | null;
};

/**
 * The organization's records among `refs`, each with the label the CRM shows
 * for it (a contact's full name, else their email). Missing ones are left out.
 */
async function describeRecords(
  organizationId: string,
  refs: readonly RecordRef[],
): Promise<DescribedRecord[]> {
  const ids = (kind: RecordRef["kind"]) =>
    refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
  const found: DescribedRecord[] = [];
  for (const part of chunk(ids("company"), ID_CHUNK)) {
    const rows = await db
      .select({ id: company.id, name: company.name, domain: company.domain })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          inArray(company.id, part),
        ),
      );
    found.push(
      ...rows.map((row) => ({
        kind: "company" as const,
        id: row.id,
        label: row.name,
        detail: row.domain,
      })),
    );
  }
  for (const part of chunk(ids("contact"), ID_CHUNK)) {
    const rows = await db
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        title: contact.title,
      })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, part),
        ),
      );
    found.push(
      ...rows.map((row) => ({
        kind: "contact" as const,
        id: row.id,
        label:
          [row.firstName, row.lastName].filter(Boolean).join(" ") ||
          (row.email ?? "Unnamed"),
        detail: row.title ?? row.email,
      })),
    );
  }
  for (const part of chunk(ids("deal"), ID_CHUNK)) {
    const rows = await db
      .select({ id: deal.id, name: deal.name, stage: deal.stage })
      .from(deal)
      .where(
        and(eq(deal.organizationId, organizationId), inArray(deal.id, part)),
      );
    found.push(
      ...rows.map((row) => ({
        kind: "deal" as const,
        id: row.id,
        label: row.name,
        detail: row.stage,
      })),
    );
  }
  return found;
}

// Feedback.

async function rate(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  rating: "UP" | "DOWN" | null;
}): Promise<void> {
  const where = and(
    eq(agentConversationFeedback.organizationId, input.organizationId),
    eq(agentConversationFeedback.conversationId, input.conversationId),
    eq(agentConversationFeedback.userId, input.userId),
    eq(agentConversationFeedback.messageId, input.messageId),
  );
  if (!input.rating) {
    await db.delete(agentConversationFeedback).where(where);
    return;
  }
  await db
    .insert(agentConversationFeedback)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userId: input.userId,
      messageId: input.messageId,
      rating: input.rating,
    })
    .onConflictDoUpdate({
      target: [
        agentConversationFeedback.conversationId,
        agentConversationFeedback.userId,
        agentConversationFeedback.messageId,
      ],
      set: { rating: input.rating, updatedAt: new Date().toISOString() },
    });
}

async function listFeedback(
  organizationId: string,
  userId: string,
  conversationId: string,
) {
  return db
    .select({
      messageId: agentConversationFeedback.messageId,
      rating: agentConversationFeedback.rating,
    })
    .from(agentConversationFeedback)
    .where(
      and(
        eq(agentConversationFeedback.organizationId, organizationId),
        eq(agentConversationFeedback.userId, userId),
        eq(agentConversationFeedback.conversationId, conversationId),
      ),
    );
}

// Attachments.

const attachmentColumns = () => ({
  id: agentConversationAttachment.id,
  conversationId: agentConversationAttachment.conversationId,
  name: agentConversationAttachment.name,
  mediaType: agentConversationAttachment.mediaType,
  size: agentConversationAttachment.size,
  storageKey: agentConversationAttachment.storageKey,
  createdAt: agentConversationAttachment.createdAt,
});

async function insertAttachment(values: NewAttachment): Promise<void> {
  await db.insert(agentConversationAttachment).values(values);
}

async function listAttachments(organizationId: string, conversationId: string) {
  return db
    .select(attachmentColumns())
    .from(agentConversationAttachment)
    .where(
      and(
        eq(agentConversationAttachment.organizationId, organizationId),
        eq(agentConversationAttachment.conversationId, conversationId),
      ),
    )
    .orderBy(asc(agentConversationAttachment.createdAt));
}

/** One of the person's attachments, by id. */
async function findAttachment(
  organizationId: string,
  userId: string,
  id: string,
) {
  const [row] = await db
    .select(attachmentColumns())
    .from(agentConversationAttachment)
    .where(
      and(
        eq(agentConversationAttachment.organizationId, organizationId),
        eq(agentConversationAttachment.userId, userId),
        eq(agentConversationAttachment.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const BuilderRepository = {
  createConversation,
  listConversations,
  findConversation,
  removeConversation,
  describeRecords,
  rate,
  listFeedback,
  insertAttachment,
  listAttachments,
  findAttachment,
};
