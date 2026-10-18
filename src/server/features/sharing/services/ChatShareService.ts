import { env } from "cloudflare:workers";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { readTranscript } from "@/server/features/agent/transcript";
import { AgentFileRepository } from "@/server/features/team-agents/repositories/AgentFileRepository";
import { BuilderRepository } from "@/server/features/team-agents/repositories/BuilderRepository";
import { answeringSessions } from "@/server/features/team-agents/runtime/answering";
import { AppError } from "@/server/lib/errors";
import { randomToken } from "@/server/lib/pkce";
import { ChatShareRepository } from "../repositories/ChatShareRepository";

// Sharing a builder chat read-only, as the CRM's conversation sharing: its
// owner makes one link for anyone in the workspace, and can replace or revoke
// it. Only the token's SHA-256 is kept, so a link is shown once, when it is
// made, and replacing or revoking it stops the old one at once. A link opens
// only in its own organization: anyone else gets not found.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId">;

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Only a chat's owner sees or changes its link. */
async function requireOwnChat(context: Context, conversationId: string) {
  const chat = await BuilderRepository.findConversation(
    context.organizationId,
    context.userId,
    conversationId,
  );
  if (!chat) throw new AppError("NOT_FOUND");
}

async function status(context: Context, conversationId: string) {
  await requireOwnChat(context, conversationId);
  return {
    shared: await ChatShareRepository.isShared(
      context.organizationId,
      conversationId,
    ),
  };
}

/** A new link for the chat, in place of any it had; its token, this once. */
async function create(context: Context, conversationId: string) {
  await requireOwnChat(context, conversationId);
  const token = randomToken();
  await ChatShareRepository.replace(
    context.organizationId,
    conversationId,
    await hashToken(token),
  );
  return { token };
}

async function revoke(context: Context, conversationId: string) {
  await requireOwnChat(context, conversationId);
  await ChatShareRepository.remove(context.organizationId, conversationId);
  return { id: conversationId };
}

/**
 * The chat a link opens, to read: its messages, the files its builder wrote,
 * and whether a turn is answering now. Its socket stays its owner's alone.
 */
async function open(context: Context, token: string) {
  const chat = await ChatShareRepository.findChat(
    context.organizationId,
    await hashToken(token),
  );
  if (!chat) throw new AppError("NOT_FOUND");
  const [messages, files, answering] = await Promise.all([
    readTranscript(chat.sessionId),
    AgentFileRepository.conversationFiles(context.organizationId, chat.id),
    answeringSessions([chat.sessionId]),
  ]);
  return {
    title: chat.agentName ?? chat.title,
    ownerName: chat.ownerName,
    // As JSON: a message's parts hold values a server function can't type.
    messagesJson: JSON.stringify(messages),
    files: files.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content,
      previousContent: file.previousContent,
      revision: file.revision,
      status: file.status,
    })),
    working: answering.has(chat.sessionId),
  };
}

/** A file attached in the chat a link opens, with its bytes, or null. */
async function attachment(context: Context, token: string, id: string) {
  const row = await ChatShareRepository.findAttachment(
    context.organizationId,
    await hashToken(token),
    id,
  );
  if (!row) return null;
  const object = await env.R2.get(row.storageKey);
  return object ? { row, object } : null;
}

export const ChatShareService = { status, create, revoke, open, attachment };
