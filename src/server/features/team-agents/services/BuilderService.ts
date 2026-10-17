import { env } from "cloudflare:workers";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AgentConversationRepository } from "@/server/features/agent/repositories/AgentConversationRepository";
import { AgentProfileRepository } from "@/server/features/agent/repositories/AgentProfileRepository";
import { sessionName } from "@/server/features/agent/sessionName";
import { SearchService } from "@/server/features/search/services/SearchService";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { AppError } from "@/server/lib/errors";
import { DEFAULT_AGENT_MODEL } from "@/server/lib/openrouter";
import type { RecordRef } from "@/shared/records";
import {
  agentManifest,
  SLACK_RESOURCE,
  TEAM_AGENT_LIMITS,
} from "@/shared/team-agents";
import { BuilderRepository } from "../repositories/BuilderRepository";
import {
  TeamAgentRepository,
  type NewArtifact,
  type NewAudit,
} from "../repositories/TeamAgentRepository";
import {
  assertNoSecrets,
  draftIssues,
  eventCatalog,
  FILE_LANGUAGES,
  manifestOf,
  versionFiles,
  type BuilderFilePath,
  type DraftInput,
} from "./draft";

// The agent builder's side of the CRM, ported from the CRM's conversations
// service (builder chats) and builder-runtime.ts (what the builder's tools
// do). A builder chat is a person's private conversation with the agent
// builder, held in its CrmAgent session like a record chat; saving a draft
// makes an immutable READY version for human review and never deploys it.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

/** The agents-client route name for CrmAgent, as record chats use it. */
const AGENT_ROUTE = "crm-agent";

const MAX_ATTACHMENT_BYTES = 2_000_000;
const TEXT_ATTACHMENT_CHARS = 20_000;

/** What a builder tool knows about the chat it runs in. */
export type BuilderToolContext = {
  organizationId: string;
  userId: string;
  conversationId: string;
  /** Records the person tagged in the chat's messages. */
  tagged: RecordRef[];
};

function summary(
  row: NonNullable<Awaited<ReturnType<typeof BuilderRepository.findConversation>>>,
) {
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

async function listConversations(context: Context) {
  const rows = await BuilderRepository.listConversations(
    context.organizationId,
    context.userId,
  );
  return rows.map(summary);
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
    TeamAgentRepository.conversationFiles(organizationId, id),
    BuilderRepository.listFeedback(organizationId, context.userId, id),
    BuilderRepository.listAttachments(organizationId, id),
    row.agentId
      ? TeamAgentRepository.latestVersion(organizationId, row.agentId)
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
      revision: file.revision,
      status: file.status,
    })),
    feedback,
    attachments: attachments.map(({ storageKey: _key, ...attachment }) => attachment),
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
  const row = await BuilderRepository.findConversation(organizationId, userId, id);
  if (!row) throw new AppError("NOT_FOUND");
  const attachments = await BuilderRepository.listAttachments(organizationId, id);
  await TeamAgentRepository.deleteUnsavedFiles(organizationId, id);
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

/** Records and integrations a person can tag in the composer. */
async function searchResources(context: Context, q: string) {
  const [{ hits }, slack] = await Promise.all([
    SearchService.quick(context.organizationId, q),
    SlackService.isConnected(context.organizationId),
  ]);
  const term = q.trim().toLowerCase();
  return [
    ...(slack && (!term || "slack".includes(term))
      ? [
          {
            kind: "integration" as const,
            id: SLACK_RESOURCE.id,
            label: SLACK_RESOURCE.label,
            detail: "Connected workspace",
          },
        ]
      : []),
    ...hits.map((hit) => ({
      kind: hit.kind,
      id: hit.id,
      label: hit.label,
      detail: hit.detail,
    })),
  ];
}

async function rate(
  context: Context,
  input: { conversationId: string; messageId: string; rating: "UP" | "DOWN" | null },
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
  return { id, name: input.name, mediaType: input.mediaType, size: bytes.length };
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

function isText(mediaType: string): boolean {
  return /^text\/|^application\/(json|xml|csv|x-yaml|yaml)/i.test(mediaType);
}

/** A text attachment's contents, for the builder's read_attachment. */
async function readAttachment(tool: BuilderToolContext, id: string) {
  const row = await BuilderRepository.findAttachment(
    tool.organizationId,
    tool.userId,
    id,
  );
  if (!row || row.conversationId !== tool.conversationId) {
    return { read: false as const, reason: "No such attachment in this chat." };
  }
  if (!isText(row.mediaType)) {
    return {
      read: false as const,
      reason: `${row.name} is ${row.mediaType}; only text files can be read here. Ask the person what it shows if it matters.`,
    };
  }
  const object = await env.R2.get(row.storageKey);
  if (!object) return { read: false as const, reason: "The file is gone." };
  const text = await object.text();
  return {
    read: true as const,
    name: row.name,
    text: text.slice(0, TEXT_ATTACHMENT_CHARS),
    truncated: text.length > TEXT_ATTACHMENT_CHARS,
  };
}

async function describeTagged(tool: BuilderToolContext) {
  return BuilderRepository.describeRecords(tool.organizationId, tool.tagged);
}

/**
 * inspect_context: the authority on what the builder may use: connected
 * integrations and the Slack inventory, the CRM event catalog, the records
 * tagged in the chat, any existing draft, and the time.
 */
async function builderContext(tool: BuilderToolContext) {
  const { organizationId, conversationId } = tool;
  const [conversation, slack, resources, agent] = await Promise.all([
    BuilderRepository.findConversation(organizationId, tool.userId, conversationId),
    SlackService.builderInventory(organizationId),
    describeTagged(tool),
    TeamAgentRepository.findByConversation(organizationId, conversationId),
  ]);
  if (!conversation) throw new Error("This builder conversation is unavailable.");
  const version = agent
    ? await TeamAgentRepository.latestVersion(organizationId, agent.id)
    : null;
  return {
    conversation: { id: conversation.id, title: conversation.title },
    availableConnections: {
      slack: slack.connected,
      slackChannels: slack.channels,
      slackPeople: slack.people,
      // Gmail and Calendar grants need mail capture, which this CRM doesn't
      // have yet.
      gmail: false,
      calendar: false,
    },
    crmEvents: eventCatalog(),
    resources,
    limits: {
      minScheduleMinutes: TEAM_AGENT_LIMITS.minScheduleMinutes,
      maxRunsPerDay: TEAM_AGENT_LIMITS.maxRunsPerDay,
    },
    existingDraft: agent
      ? {
          id: agent.id,
          name: agent.name,
          status: agent.status,
          latestVersion: version
            ? {
                number: version.number,
                status: version.status,
                instructions: version.instructions,
                manifest: version.manifest,
              }
            : null,
        }
      : null,
    now: new Date().toISOString(),
  };
}

/** write_agent_file: a working revision the person watches being written. */
async function writeFile(
  tool: BuilderToolContext,
  path: BuilderFilePath,
  content: string,
) {
  assertNoSecrets(content);
  const written = await TeamAgentRepository.writeArtifact({
    organizationId: tool.organizationId,
    conversationId: tool.conversationId,
    path,
    language: FILE_LANGUAGES[path],
    content,
  });
  return { saved: true as const, ...written };
}

function sameVersion(
  latest: { status: string; instructions: string; modelId: string; manifest: unknown },
  input: { instructions: string; modelId: string; manifest: unknown },
): boolean {
  return (
    latest.status === "READY" &&
    latest.instructions === input.instructions &&
    latest.modelId === input.modelId &&
    JSON.stringify(latest.manifest) === JSON.stringify(input.manifest)
  );
}

/**
 * save_agent_draft: checks the draft and, when it holds, saves it as the
 * chat's agent's next READY version with its triggers (disabled until a
 * person deploys it) and the exact files. The chat's first save creates the
 * agent, private to its creator. A save identical to the newest READY
 * version changes nothing.
 */
async function saveDraft(tool: BuilderToolContext, input: DraftInput) {
  const { organizationId, userId, conversationId } = tool;
  const conversation = await BuilderRepository.findConversation(
    organizationId,
    userId,
    conversationId,
  );
  if (!conversation) throw new Error("This builder conversation is unavailable.");
  const [tagged, slack] = await Promise.all([
    describeTagged(tool),
    SlackService.builderInventory(organizationId),
  ]);
  const existing = await BuilderRepository.describeRecords(
    organizationId,
    input.resources,
  );
  const now = new Date();
  const issues = draftIssues(input, tagged, existing, slack, now);
  if (issues.length > 0) {
    return {
      saved: false as const,
      issues,
      availableConnections: {
        slack: slack.connected,
        slackChannels: slack.channels,
        slackPeople: slack.people,
      },
    };
  }
  const manifest = manifestOf(input);
  const files = versionFiles(input, manifest);
  for (const file of files) assertNoSecrets(file.content);
  const modelId =
    (await AgentProfileRepository.agentModelId(organizationId)) ??
    DEFAULT_AGENT_MODEL.id;

  const agent = await TeamAgentRepository.findByConversation(
    organizationId,
    conversationId,
  );
  if (agent?.status === "DELETED") {
    throw new Error("This chat's agent was deleted. Start a new chat to build another.");
  }
  const agentId = agent?.id ?? crypto.randomUUID();
  const latest = agent
    ? await TeamAgentRepository.latestVersion(organizationId, agentId)
    : null;
  if (
    latest &&
    sameVersion(latest, { instructions: input.instructions, modelId, manifest })
  ) {
    return {
      saved: true as const,
      agentId,
      versionId: latest.id,
      versionNumber: latest.number,
      status: latest.status,
    };
  }

  const versionId = crypto.randomUUID();
  const number = (latest?.number ?? 0) + 1;
  const working = await TeamAgentRepository.conversationFiles(
    organizationId,
    conversationId,
  );
  const claimed: string[] = [];
  const artifacts: NewArtifact[] = [];
  for (const file of files) {
    const held = working.find((row) => row.path === file.path);
    if (held?.content === file.content && held.status === "WRITING" && !held.versionId) {
      claimed.push(held.id);
      continue;
    }
    artifacts.push({
      id: crypto.randomUUID(),
      organizationId,
      conversationId,
      versionId,
      path: file.path,
      language: FILE_LANGUAGES[file.path],
      content: file.content,
      previousContent: held?.content ?? null,
      revision: (held?.revision ?? 0) + 1,
      status: "READY",
    });
  }
  const audit: NewAudit[] = [
    ...(agent
      ? []
      : [
          {
            organizationId,
            agentId,
            actorUserId: userId,
            actorType: "USER" as const,
            type: "agent.created",
            summary: "Created a draft agent from a private builder chat",
            requestId: `builder:${conversationId}`,
          },
        ]),
    {
      organizationId,
      agentId,
      versionId,
      actorUserId: userId,
      actorType: "USER",
      type: "version.created",
      summary: `Prepared version ${number} for review`,
      after: { status: "READY" },
      requestId: versionId,
    },
  ];
  await TeamAgentRepository.saveVersion({
    agent: agent
      ? undefined
      : {
          id: agentId,
          organizationId,
          name: input.name,
          description: input.description,
          createdById: userId,
          conversationId,
        },
    renameDraft:
      agent?.status === "DRAFT"
        ? { name: input.name, description: input.description }
        : undefined,
    version: {
      id: versionId,
      organizationId,
      agentId,
      number,
      status: "READY",
      instructions: input.instructions,
      manifest,
      modelId,
      sourceConversationId: conversationId,
      createdById: userId,
    },
    triggers: input.triggers.map((trigger) => ({
      id: crypto.randomUUID(),
      organizationId,
      agentId,
      versionId,
      type: trigger.type,
      name: trigger.name,
      summary: trigger.summary,
      event: trigger.type === "EVENT" ? trigger.event : null,
      intervalMinutes:
        trigger.type === "SCHEDULE" ? trigger.intervalMinutes : null,
      nextRunAt:
        trigger.type === "SCHEDULE"
          ? new Date(trigger.nextRunAt).toISOString()
          : null,
      enabled: false,
    })),
    artifacts,
    claimedArtifactIds: claimed,
    audit,
  });
  console.log("[team-agents] version saved", {
    organizationId,
    agentId,
    versionId,
    number,
  });
  return {
    saved: true as const,
    agentId,
    versionId,
    versionNumber: number,
    status: "READY" as const,
  };
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
  readAttachment,
  builderContext,
  writeFile,
  saveDraft,
};
