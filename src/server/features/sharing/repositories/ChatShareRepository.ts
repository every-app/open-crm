import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agentConversation,
  agentConversationAttachment,
  agentConversationShare,
  agentDefinition,
  user,
} from "@/db/schema";

// A builder chat's read-only link (agent_conversation_share): one row per
// shared chat, holding the SHA-256 of its token. Every read and write is the
// organization's; the service checks the chat is the caller's before it
// writes.

async function isShared(
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ conversationId: agentConversationShare.conversationId })
    .from(agentConversationShare)
    .where(
      and(
        eq(agentConversationShare.organizationId, organizationId),
        eq(agentConversationShare.conversationId, conversationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Makes `tokenHash` the chat's link, in place of any it had. */
async function replace(
  organizationId: string,
  conversationId: string,
  tokenHash: string,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await db
    .insert(agentConversationShare)
    .values({ conversationId, organizationId, tokenHash, createdAt })
    .onConflictDoUpdate({
      target: agentConversationShare.conversationId,
      set: { tokenHash, createdAt },
      setWhere: eq(agentConversationShare.organizationId, organizationId),
    });
}

async function remove(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db
    .delete(agentConversationShare)
    .where(
      and(
        eq(agentConversationShare.organizationId, organizationId),
        eq(agentConversationShare.conversationId, conversationId),
      ),
    );
}

/**
 * The organization's builder chat whose link has `tokenHash`, with its
 * owner's name and the agent it made, or null.
 */
async function findChat(organizationId: string, tokenHash: string) {
  const [row] = await db
    .select({
      id: agentConversation.id,
      sessionId: agentConversation.sessionId,
      title: agentConversation.title,
      ownerName: user.name,
      agentName: agentDefinition.name,
    })
    .from(agentConversationShare)
    .innerJoin(
      agentConversation,
      and(
        eq(agentConversation.id, agentConversationShare.conversationId),
        eq(agentConversation.organizationId, organizationId),
        eq(agentConversation.kind, "BUILDER"),
      ),
    )
    .innerJoin(user, eq(user.id, agentConversation.userId))
    .leftJoin(
      agentDefinition,
      and(
        eq(agentDefinition.conversationId, agentConversation.id),
        eq(agentDefinition.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(agentConversationShare.organizationId, organizationId),
        eq(agentConversationShare.tokenHash, tokenHash),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** An attachment of the chat whose link has `tokenHash`, or null. */
async function findAttachment(
  organizationId: string,
  tokenHash: string,
  attachmentId: string,
) {
  const [row] = await db
    .select({
      name: agentConversationAttachment.name,
      mediaType: agentConversationAttachment.mediaType,
      storageKey: agentConversationAttachment.storageKey,
    })
    .from(agentConversationAttachment)
    .innerJoin(
      agentConversationShare,
      and(
        eq(
          agentConversationShare.conversationId,
          agentConversationAttachment.conversationId,
        ),
        eq(agentConversationShare.organizationId, organizationId),
        eq(agentConversationShare.tokenHash, tokenHash),
      ),
    )
    .where(
      and(
        eq(agentConversationAttachment.organizationId, organizationId),
        eq(agentConversationAttachment.id, attachmentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const ChatShareRepository = {
  isShared,
  replace,
  remove,
  findChat,
  findAttachment,
};
