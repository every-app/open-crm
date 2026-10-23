import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { env } from "cloudflare:workers";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import type { RecordRef } from "@/shared/records";
import {
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  SLACK_RESOURCE,
  slackChannelResourceId,
} from "@/shared/team-agents";
import { AgentFileRepository } from "../repositories/AgentFileRepository";
import { AgentDraftService } from "./AgentDraftService";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";
import {
  assertNoSecrets,
  eventCatalog,
  FILE_LANGUAGES,
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
const captureConnections = AgentDraftService.captureConnections;

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
      ...[
        ...CAPTURE_KINDS.map((kind) => CAPTURE_GRANTS[kind].resource),
        SLACK_RESOURCE,
      ].filter((resource) => tool.taggedIntegrations.includes(resource.id)),
      // A Slack channel the person tagged, under the name Slack gives it.
      ...slack.channels.flatMap((channel) => {
        const id = slackChannelResourceId(channel.id);
        return tool.taggedIntegrations.includes(id)
          ? [{ kind: "integration" as const, id, label: channel.label }]
          : [];
      }),
    ],
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

async function saveDraft(tool: BuilderToolContext, input: DraftInput) {
  const conversation = await BuilderRepository.findConversation(
    tool.organizationId,
    tool.userId,
    tool.conversationId,
  );
  if (!conversation)
    throw new Error("This builder conversation is unavailable.");
  const agent = await TeamAgentRepository.findByConversation(
    tool.organizationId,
    tool.conversationId,
  );
  return AgentDraftService.saveDraft({ ...tool, agent }, input);
}

export const BuilderToolService = {
  captureConnections,
  readAttachment,
  builderContext,
  writeFile,
  saveDraft,
};
