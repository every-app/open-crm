import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { AgentFileRepository } from "@/server/features/team-agents/repositories/AgentFileRepository";
import { env } from "cloudflare:workers";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AgentConversationRepository } from "@/server/features/agent/repositories/AgentConversationRepository";
import { sessionName } from "@/server/features/agent/sessionName";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { AppError } from "@/server/lib/errors";
import {
  agentManifest,
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  SLACK_RESOURCE,
} from "@/shared/team-agents";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { BuilderResourceRepository } from "../repositories/BuilderResourceRepository";
import { answeringSessions } from "../runtime/answering";
import { BuilderToolService } from "./BuilderToolService";

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

async function createConversation(context: Context) {
  const created = await BuilderRepository.createConversation({
    organizationId: context.organizationId,
    userId: context.userId,
    sessionId: sessionName("chat", context.organizationId, crypto.randomUUID()),
  });
  const row = await BuilderRepository.findConversation(
    context.organizationId,
    context.userId,
    created.id,
  );
  if (!row) throw new Error("Builder chat missing after insert");
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

const CAPTURE_TAGS = {
  email: {
    detail: "Captured mail on CRM records",
    unavailable:
      "Nobody here has connected a mailbox yet (Settings → Connections)",
  },
  calendar: {
    detail: "Captured meetings on CRM records",
    unavailable:
      "Nobody here has connected a calendar yet (Settings → Connections)",
  },
} as const;

/** How many records of each kind the tag picker offers. */
const TAGGABLE_PER_KIND = 6;

type Picture = {
  url: string | null;
  darkUrl: string | null;
  tone: string | null;
};

const NO_PICTURE: Picture = { url: null, darkUrl: null, tone: null };

/**
 * Records and integrations a person can tag in the composer, as the CRM's
 * builder resources: before they type, the most recently active companies,
 * contacts and deals. Email and Calendar are always offered, with the reason
 * they can't be granted yet when no member has connected one.
 */
async function searchResources(context: Context, q: string) {
  const term = q.trim();
  const [records, slack, capture] = await Promise.all([
    BuilderResourceRepository.taggableRecords(
      context.organizationId,
      term,
      TAGGABLE_PER_KIND,
    ),
    SlackService.isConnected(context.organizationId),
    BuilderToolService.captureConnections(context.organizationId),
  ]);
  const matches = (label: string) =>
    !term || label.toLowerCase().includes(term.toLowerCase());
  return [
    ...CAPTURE_KINDS.filter((kind) =>
      matches(CAPTURE_GRANTS[kind].resource.label),
    ).map((kind) => ({
      kind: "integration" as const,
      id: CAPTURE_GRANTS[kind].resource.id,
      label: CAPTURE_GRANTS[kind].resource.label,
      detail: CAPTURE_TAGS[kind].detail,
      picture: NO_PICTURE,
      unavailable: capture[kind] ? null : CAPTURE_TAGS[kind].unavailable,
    })),
    ...(slack && matches("slack")
      ? [
          {
            kind: "integration" as const,
            id: SLACK_RESOURCE.id,
            label: SLACK_RESOURCE.label,
            detail: "Connected workspace",
            picture: NO_PICTURE,
            unavailable: null,
          },
        ]
      : []),
    ...records.companies.map((row) => ({
      kind: "company" as const,
      id: row.id,
      label: row.name,
      detail: row.domain,
      picture: {
        url: row.iconUrl,
        darkUrl: row.iconDarkUrl,
        tone: row.iconTone,
      },
      unavailable: null,
    })),
    ...records.contacts.map((row) => ({
      kind: "contact" as const,
      id: row.id,
      label:
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        (row.email ?? "Unnamed"),
      detail: row.companyName ?? row.email,
      picture: { ...NO_PICTURE, url: row.imageUrl },
      unavailable: null,
    })),
    ...records.deals.map((row) => ({
      kind: "deal" as const,
      id: row.id,
      label: row.name,
      detail: row.companyName,
      picture: {
        url: row.iconUrl,
        darkUrl: row.iconDarkUrl,
        tone: row.iconTone,
      },
      unavailable: null,
    })),
  ];
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
  const bytes = Uint8Array.from(atob(input.contentBase64), (char) =>
    char.charCodeAt(0),
  );
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Attachments are up to 2 MB.");
  }
  const id = crypto.randomUUID();
  // Not under the organization's image prefix (src/server/lib/images.ts),
  // which every member may read: an attachment is its chat's owner's.
  const storageKey = `builder-attachments/${context.organizationId}/${input.conversationId}/${id}`;
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
  createConversation,
  listConversations,
  getConversation,
  markRead,
  removeConversation,
  searchResources,
  rate,
  uploadAttachment,
  attachmentObject,
};
