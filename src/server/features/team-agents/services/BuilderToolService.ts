import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { env } from "cloudflare:workers";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import type { RecordRef } from "@/shared/records";
import {
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  SLACK_RESOURCE,
  type CaptureGrants,
} from "@/shared/team-agents";
import {
  AgentFileRepository,
  type NewArtifact,
} from "../repositories/AgentFileRepository";
import type { NewAudit } from "../repositories/AuditRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";
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

// What the agent builder's tools do (runtime/builderTools.ts), ported from
// the CRM's builder-runtime.ts: inspect what it may build with, write the
// agent's files where the person can watch, and save a draft as an immutable
// READY version for human review. Saving never deploys.

const TEXT_ATTACHMENT_CHARS = 20_000;

/** What a builder tool knows about the chat it runs in. */
export type BuilderToolContext = {
  organizationId: string;
  userId: string;
  conversationId: string;
  /** Records the person tagged in the chat's messages. */
  tagged: RecordRef[];
  /** Integration ids the person tagged (Email, Calendar, Slack). */
  taggedIntegrations: string[];
};

/**
 * Whether a version could be granted the captured email and meetings: some
 * member of the workspace has connected a mailbox, or a calendar.
 */
async function captureConnections(
  organizationId: string,
): Promise<CaptureGrants> {
  const sources = await ConnectionRepository.connectedSources(organizationId);
  return {
    email: CAPTURE_GRANTS.email.sources.some((source) => sources.has(source)),
    calendar: CAPTURE_GRANTS.calendar.sources.some((source) =>
      sources.has(source),
    ),
  };
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
  const [conversation, slack, capture, resources, agent] = await Promise.all([
    BuilderRepository.findConversation(
      organizationId,
      tool.userId,
      conversationId,
    ),
    SlackInventoryService.builderInventory(organizationId),
    captureConnections(organizationId),
    describeTagged(tool),
    TeamAgentRepository.findByConversation(organizationId, conversationId),
  ]);
  if (!conversation)
    throw new Error("This builder conversation is unavailable.");
  const version = agent
    ? await AgentVersionRepository.latestVersion(organizationId, agent.id)
    : null;
  return {
    conversation: { id: conversation.id, title: conversation.title },
    availableConnections: {
      slack: slack.connected,
      slackChannels: slack.channels,
      slackPeople: slack.people,
      email: capture.email,
      calendar: capture.calendar,
    },
    crmEvents: eventCatalog(),
    resources,
    taggedIntegrations: [
      ...CAPTURE_KINDS.map((kind) => CAPTURE_GRANTS[kind].resource),
      SLACK_RESOURCE,
    ].filter((resource) => tool.taggedIntegrations.includes(resource.id)),
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
  const written = await AgentFileRepository.writeArtifact({
    organizationId: tool.organizationId,
    conversationId: tool.conversationId,
    path,
    language: FILE_LANGUAGES[path],
    content,
  });
  return { saved: true as const, ...written };
}

function sameVersion(
  latest: {
    status: string;
    instructions: string;
    manifest: unknown;
  },
  input: { instructions: string; manifest: unknown },
): boolean {
  return (
    latest.status === "READY" &&
    latest.instructions === input.instructions &&
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
  if (!conversation)
    throw new Error("This builder conversation is unavailable.");
  const [tagged, slack, capture] = await Promise.all([
    describeTagged(tool),
    SlackInventoryService.builderInventory(organizationId),
    captureConnections(organizationId),
  ]);
  const existing = await BuilderRepository.describeRecords(
    organizationId,
    input.resources,
  );
  const now = new Date();
  const issues = draftIssues(input, tagged, existing, { slack, capture }, now);
  if (issues.length > 0) {
    return {
      saved: false as const,
      issues,
      availableConnections: {
        slack: slack.connected,
        slackChannels: slack.channels,
        slackPeople: slack.people,
        email: capture.email,
        calendar: capture.calendar,
      },
    };
  }
  const manifest = manifestOf(input);
  const files = versionFiles(input, manifest);
  for (const file of files) assertNoSecrets(file.content);
  const agent = await TeamAgentRepository.findByConversation(
    organizationId,
    conversationId,
  );
  if (agent?.status === "DELETED") {
    throw new Error(
      "This chat's agent was deleted. Start a new chat to build another.",
    );
  }
  const agentId = agent?.id ?? crypto.randomUUID();
  const latest = agent
    ? await AgentVersionRepository.latestVersion(organizationId, agentId)
    : null;
  if (
    latest &&
    sameVersion(latest, { instructions: input.instructions, manifest })
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
  const working = await AgentFileRepository.conversationFiles(
    organizationId,
    conversationId,
  );
  const claimed: string[] = [];
  const artifacts: NewArtifact[] = [];
  for (const file of files) {
    const held = working.find((row) => row.path === file.path);
    if (
      held?.content === file.content &&
      held.status === "WRITING" &&
      !held.versionId
    ) {
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
  await AgentVersionRepository.saveVersion({
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

export const BuilderToolService = {
  captureConnections,
  readAttachment,
  builderContext,
  writeFile,
  saveDraft,
};
