import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { AgentFileRepository } from "@/server/features/team-agents/repositories/AgentFileRepository";
import { env } from "cloudflare:workers";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AgentConversationRepository } from "@/server/features/agent/repositories/AgentConversationRepository";
import { sessionName } from "@/server/features/agent/sessionName";
import { AppError } from "@/server/lib/errors";
import { agentManifest } from "@/shared/team-agents";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { answeringSessions } from "../runtime/answering";
import { handFirstMessage } from "../runtime/firstMessage";

// The agent builder's side of the CRM, ported from the CRM's conversations
// service (builder chats) and builder-runtime.ts (what the builder's tools
// do). A builder chat is a person's private conversation with the agent
// builder, held in its CrmAgent session like a record chat; saving a draft
// makes an immutable READY version for human review and never deploys it.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

/** The agents-client route name for CrmAgent, as record chats use it. */
const AGENT_ROUTE = "crm-agent";

const MAX_ATTACHMENT_BYTES = 2_000_000;

/**
 * A chat whose last turn started this long ago has finished or died: its
 * agent is no longer asked whether it is still answering.
 */
const ANSWERING_WINDOW_MS = 30 * 60_000;

type ConversationRow = NonNullable<
  Awaited<ReturnType<typeof BuilderRepository.findConversation>>
>;

function summary(row: ConversationRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    agent: AGENT_ROUTE,
    title: row.title,
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt,
    unread: Boolean(
      row.lastAssistantAt &&
      (!row.lastReadAt || row.lastAssistantAt > row.lastReadAt),
    ),
    madeAgent: row.agentId
      ? { id: row.agentId, name: row.agentName, status: row.agentStatus }
      : null,
  };
}

/** A file's bytes from its base64, refused past the size a chat keeps. */
function attachmentBytes(contentBase64: string): Uint8Array {
  const bytes = Uint8Array.from(atob(contentBase64), (char) =>
    char.charCodeAt(0),
  );
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Attachments are up to 2 MB.");
  }
  return bytes;
}

// Not under the organization's image prefix (src/server/lib/images.ts),
// which every member may read: an attachment is its chat's owner's.
const attachmentKey = (organizationId: string, chatId: string, id: string) =>
  `builder-attachments/${organizationId}/${chatId}/${id}`;

/**
 * Starts a chat from Chat home, as the CRM's createBuilder: the chat, the
 * files its first message attaches and that message, in one call. Nothing is
 * left behind when a file can't be kept or the message can't be handed to
 * the chat's agent. A retry with the same chat id finds the chat its first
 * try started and hands its message again, which the agent takes once.
 */
async function startConversation(
  context: Context,
  input: {
    chatId: string;
    text: string;
    resources: Array<{ kind: string; id: string; label: string }>;
    attachments: Array<{
      name: string;
      mediaType: string;
      contentBase64: string;
    }>;
  },
) {
  const { organizationId, userId } = context;
  const find = () =>
    BuilderRepository.findConversation(organizationId, userId, input.chatId);
  let row = await find();
  let started = false;
  if (!row) {
    const files = input.attachments.map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        organizationId,
        conversationId: input.chatId,
        userId,
        name: file.name,
        mediaType: file.mediaType,
        bytes: attachmentBytes(file.contentBase64),
        storageKey: attachmentKey(organizationId, input.chatId, id),
      };
    });
    try {
      for (const file of files) {
        await env.R2.put(file.storageKey, file.bytes, {
          httpMetadata: { contentType: file.mediaType },
        });
      }
      await BuilderRepository.createConversation({
        id: input.chatId,
        organizationId,
        userId,
        sessionId: sessionName("chat", organizationId, crypto.randomUUID()),
        attachments: files.map(({ bytes, ...file }) => ({
          ...file,
          size: bytes.length,
        })),
      });
      started = true;
    } catch (error) {
      if (files.length > 0) {
        await env.R2.delete(files.map((file) => file.storageKey));
      }
      // A retry that ran alongside its first try finds the chat that one
      // started; anything else failed.
      if (!(await find())) throw error;
    }
    row = await find();
    if (!row) throw new Error("Builder chat missing after insert");
  }
  const attachments = await BuilderRepository.listAttachments(
    organizationId,
    row.id,
  );
  try {
    await handFirstMessage(row.sessionId, {
      id: row.id,
      role: "user",
      parts: [{ type: "text", text: input.text }],
      metadata: {
        resources: input.resources,
        attachments: attachments.map(({ id, name, mediaType, size }) => ({
          id,
          name,
          mediaType,
          size,
        })),
      },
    });
  } catch (error) {
    if (started) await removeConversation(context, row.id);
    throw error;
  }
  return summary(row);
}

/** A turn started in the chat lately and no reply has completed since. */
function mayBeAnswering(row: ConversationRow, now: number): boolean {
  return (
    row.messageCount > 0 &&
    row.lastMessageAt > (row.lastAssistantAt ?? "") &&
    now - Date.parse(row.lastMessageAt) < ANSWERING_WINDOW_MS
  );
}

/**
 * The person's builder chats, each with its state in Chat's column, ranked
 * as the CRM ranks them: the agent it made is live, a turn is answering
 * (its agent says so), a reply is unread.
 */
async function listConversations(context: Context) {
  const rows = await BuilderRepository.listConversations(
    context.organizationId,
    context.userId,
  );
  const now = Date.now();
  const answering = await answeringSessions(
    rows.filter((row) => mayBeAnswering(row, now)).map((row) => row.sessionId),
  );
  return rows.map((row) => {
    const chat = summary(row);
    const state =
      chat.madeAgent?.status === "LIVE"
        ? ("deployed" as const)
        : answering.has(row.sessionId)
          ? ("working" as const)
          : chat.unread
            ? ("unread" as const)
            : ("idle" as const);
    return { ...chat, state };
  });
}

/**
 * A builder chat for its page: the chat, the agent it made with its newest
 * version, the files it wrote (newest revision of each), the person's
 * feedback and attachments.
 */
async function getConversation(context: Context, id: string) {
  const row = await BuilderRepository.findConversation(
    context.organizationId,
    context.userId,
    id,
  );
  if (!row) throw new AppError("NOT_FOUND");
  const { organizationId } = context;
  const [files, feedback, attachments, version] = await Promise.all([
    AgentFileRepository.conversationFiles(organizationId, id),
    BuilderRepository.listFeedback(organizationId, context.userId, id),
    BuilderRepository.listAttachments(organizationId, id),
    row.agentId
      ? AgentVersionRepository.latestVersion(organizationId, row.agentId)
      : null,
  ]);
  const manifest = version ? agentManifest.safeParse(version.manifest) : null;
  return {
    conversation: summary(row),
    version: version
      ? {
          id: version.id,
          number: version.number,
          status: version.status,
          createdAt: version.createdAt,
          manifest: manifest?.success ? manifest.data : null,
        }
      : null,
    files: files.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content,
      previousContent: file.previousContent,
      revision: file.revision,
      status: file.status,
    })),
    feedback,
    attachments: attachments.map(
      ({ storageKey: _key, ...attachment }) => attachment,
    ),
  };
}

async function markRead(context: Context, id: string) {
  const read = await AgentConversationRepository.markRead(
    context.organizationId,
    context.userId,
    id,
  );
  if (!read) throw new AppError("NOT_FOUND");
  return { id };
}

/**
 * Deletes a builder chat: its working files (a saved version keeps its own),
 * its attachments and the row. The agent it made stays. Returns the session
 * whose transcript the caller empties.
 */
async function removeConversation(context: Context, id: string) {
  const { organizationId, userId } = context;
  const row = await BuilderRepository.findConversation(
    organizationId,
    userId,
    id,
  );
  if (!row) throw new AppError("NOT_FOUND");
  const attachments = await BuilderRepository.listAttachments(
    organizationId,
    id,
  );
  await AgentFileRepository.deleteUnsavedFiles(organizationId, id);
  const removed = await BuilderRepository.removeConversation(
    organizationId,
    userId,
    id,
  );
  if (!removed) throw new AppError("NOT_FOUND");
  if (attachments.length > 0) {
    await env.R2.delete(attachments.map((attachment) => attachment.storageKey));
  }
  return removed;
}

async function rate(
  context: Context,
  input: {
    conversationId: string;
    messageId: string;
    rating: "UP" | "DOWN" | null;
  },
) {
  const row = await BuilderRepository.findConversation(
    context.organizationId,
    context.userId,
    input.conversationId,
  );
  if (!row) throw new AppError("NOT_FOUND");
  await BuilderRepository.rate({
    organizationId: context.organizationId,
    userId: context.userId,
    ...input,
  });
  return { messageId: input.messageId, rating: input.rating };
}

/** Keeps a file a person attached in a builder chat, in R2. */
async function uploadAttachment(
  context: Context,
  input: {
    conversationId: string;
    name: string;
    mediaType: string;
    contentBase64: string;
  },
) {
  const row = await BuilderRepository.findConversation(
    context.organizationId,
    context.userId,
    input.conversationId,
  );
  if (!row) throw new AppError("NOT_FOUND");
  const bytes = attachmentBytes(input.contentBase64);
  const id = crypto.randomUUID();
  const storageKey = attachmentKey(
    context.organizationId,
    input.conversationId,
    id,
  );
  await env.R2.put(storageKey, bytes, {
    httpMetadata: { contentType: input.mediaType },
  });
  await BuilderRepository.insertAttachment({
    id,
    organizationId: context.organizationId,
    conversationId: input.conversationId,
    userId: context.userId,
    name: input.name,
    mediaType: input.mediaType,
    size: bytes.length,
    storageKey,
  });
  return {
    id,
    name: input.name,
    mediaType: input.mediaType,
    size: bytes.length,
  };
}

/** An attachment's bytes, for its owner. */
async function attachmentObject(context: Context, id: string) {
  const row = await BuilderRepository.findAttachment(
    context.organizationId,
    context.userId,
    id,
  );
  if (!row) return null;
  const object = await env.R2.get(row.storageKey);
  return object ? { row, object } : null;
}

export const BuilderService = {
  startConversation,
  listConversations,
  getConversation,
  markRead,
  removeConversation,
  rate,
  uploadAttachment,
  attachmentObject,
};
