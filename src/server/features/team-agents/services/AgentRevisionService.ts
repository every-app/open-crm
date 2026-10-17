import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { AppError } from "@/server/lib/errors";
import {
  AGENT_ACTION_TYPES,
  recordResources,
  SLACK_RESOURCE,
  slackDestinationOf,
  type AgentManifest,
  type RecordResource,
} from "@/shared/team-agents";
import {
  AgentFileRepository,
  type NewArtifact,
} from "../repositories/AgentFileRepository";
import { AuditRepository } from "../repositories/AuditRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { manageableAgent } from "./access";
import { assertNoSecrets } from "./draft";
import { readable } from "./TeamAgentService";

// Changing a deployed agent from its page, as the CRM's revise and saveFile:
// turn actions off, move its Slack channel, narrow its records, or edit its
// instructions. Each change is a new deployed version at once (the person
// making it is approving it), with the triggers moved over and the old
// version kept in the history.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const INSTRUCTIONS_PATH = "agent/instructions.md";

/** The deployed version, for a change made from the detail page. */
async function deployedVersion(context: Context, agentId: string) {
  const agent = await manageableAgent(context, agentId);
  if (!agent.currentVersionId) {
    throw new AppError("CONFLICT", "Deploy this agent before changing it.");
  }
  const version = await AgentVersionRepository.findVersion(
    context.organizationId,
    agent.id,
    agent.currentVersionId,
  );
  if (!version) throw new AppError("NOT_FOUND");
  const manifest = readable(version.manifest);
  if (!manifest.readable) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This version's manifest is unreadable, so it can't be changed.",
    );
  }
  return { agent, version, manifest: manifest.manifest };
}

/** The deployed version's files carried onto `versionId`, `edit` applied. */
async function carriedFiles(
  organizationId: string,
  fromVersionId: string,
  versionId: string,
  edit: { path: string; content: string } | null,
): Promise<NewArtifact[]> {
  const rows = await AgentFileRepository.versionFiles(
    organizationId,
    fromVersionId,
  );
  return rows.map((row) => {
    const edited = edit?.path === row.path ? edit.content : null;
    return {
      id: crypto.randomUUID(),
      organizationId,
      conversationId: null,
      versionId,
      path: row.path,
      language: row.language,
      content: edited ?? row.content,
      previousContent: edited === null ? row.previousContent : row.content,
      revision: edited === null ? row.revision : row.revision + 1,
      status: "READY",
    };
  });
}

async function nextNumber(organizationId: string, agentId: string) {
  const latest = await AgentVersionRepository.latestVersion(
    organizationId,
    agentId,
  );
  return (latest?.number ?? 0) + 1;
}

/**
 * A change from the detail page, as the CRM's revise: turn actions off, move
 * the Slack destination, or change the selected records. It becomes a new
 * deployed version at once (the person changing it is approving it), and
 * the triggers move with it. A replayed request changes nothing.
 */
async function revise(
  context: Context,
  input: {
    agentId: string;
    clientRequestId: string;
    actions?: string[];
    channel?: { id: string; name: string };
    resources?: RecordResource[];
  },
) {
  const { organizationId } = context;
  const { agent, version, manifest } = await deployedVersion(
    context,
    input.agentId,
  );
  const replay = await AuditRepository.findAudit(
    organizationId,
    agent.id,
    "agent.revised",
    input.clientRequestId,
  );
  if (replay) return { versionId: replay.versionId };
  let actions = manifest.actions;
  if (input.actions) {
    const keep = new Set(input.actions);
    actions = actions.filter((action) => keep.has(action.type));
    if (
      !actions.some((action) => action.type === AGENT_ACTION_TYPES.RUN_SUMMARY)
    ) {
      throw new AppError("VALIDATION_ERROR", "An agent keeps its run summary.");
    }
  }
  const before = slackDestinationOf(manifest);
  if (input.channel) {
    if (
      !actions.some(
        (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
      )
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "None of this agent's actions post to Slack.",
      );
    }
    const channel = input.channel;
    actions = actions.map((action) =>
      action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST
        ? {
            ...action,
            destination: {
              kind: "channel",
              resolution: "chosen",
              id: channel.id,
              label: `#${channel.name}`,
            },
          }
        : action,
    );
  }
  let dataScope = manifest.dataScope;
  if (input.resources) {
    if (
      manifest.dataScope.mode === "SELECTED" &&
      input.resources.length === 0
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Keep one record: an empty list would open every record.",
      );
    }
    const described = await BuilderRepository.describeRecords(
      organizationId,
      input.resources,
    );
    const integrations = manifest.dataScope.resources.filter(
      (resource) => resource.kind === "integration",
    );
    dataScope = {
      mode: described.length > 0 ? "SELECTED" : manifest.dataScope.mode,
      summary:
        described.length > 0
          ? described.map((record) => record.label).join(" · ")
          : manifest.dataScope.summary,
      resources: [
        ...described.map(({ kind, id, label }) => ({ kind, id, label })),
        ...integrations,
      ],
    };
  }
  const slackKept = actions.some(
    (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
  );
  if (!slackKept) {
    dataScope = {
      ...dataScope,
      resources: dataScope.resources.filter(
        (resource) => resource.id !== SLACK_RESOURCE.id,
      ),
    };
  }
  const next: AgentManifest = { ...manifest, actions, dataScope };
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await AgentVersionRepository.replaceCurrentVersion({
    version: {
      id: versionId,
      organizationId,
      agentId: agent.id,
      number: await nextNumber(organizationId, agent.id),
      status: "DEPLOYED",
      instructions: version.instructions,
      manifest: next,
      modelId: version.modelId,
      sourceConversationId: version.sourceConversationId,
      createdById: context.userId,
      approvedAt: now,
      deployedAt: now,
    },
    fromVersionId: version.id,
    artifacts: await carriedFiles(organizationId, version.id, versionId, {
      path: "agent/manifest.json",
      content: `${JSON.stringify(next, null, 2)}\n`,
    }),
    audit: {
      organizationId,
      agentId: agent.id,
      versionId,
      actorUserId: context.userId,
      actorType: "USER",
      type: "agent.revised",
      summary: reviseSummary(input),
      before: {
        channel: before?.label ?? null,
        actions: manifest.actions.map((action) => action.type),
        records: recordResources(manifest.dataScope.resources).length,
      },
      after: {
        channel: input.channel ? `#${input.channel.name}` : null,
        actions: input.actions ?? null,
        records: input.resources?.length ?? null,
      },
      requestId: input.clientRequestId,
    },
  });
  // Put the app in its new channel; a channel it can't join shows on the
  // Slack card, and the run says so if it can't post.
  if (input.channel && input.channel.id !== before?.id) {
    await SlackInventoryService.joinChannel(context, input.channel.id).catch(
      (error: unknown) => {
        console.warn("[team-agents] could not join the new channel", error);
      },
    );
  }
  return { versionId };
}

function reviseSummary(input: {
  channel?: { name: string };
  actions?: string[];
  resources?: unknown[];
}): string {
  const parts: string[] = [];
  if (input.channel) parts.push(`moved to #${input.channel.name}`);
  if (input.actions) parts.push(`${input.actions.length} actions`);
  if (input.resources) parts.push(`${input.resources.length} records`);
  return parts.length > 0 ? `Changed ${parts.join(", ")}` : "Changed settings";
}

/**
 * Edits the deployed version's instructions: a new deployed version with the
 * same manifest and the edited file, as the CRM's saveFile.
 */
async function saveInstructions(
  context: Context,
  input: { agentId: string; clientRequestId: string; content: string },
) {
  const { organizationId } = context;
  const { agent, version, manifest } = await deployedVersion(
    context,
    input.agentId,
  );
  const replay = await AuditRepository.findAudit(
    organizationId,
    agent.id,
    "agent.file.saved",
    input.clientRequestId,
  );
  if (replay) return { saved: false, versionId: replay.versionId };
  const content = input.content.trim();
  try {
    assertNoSecrets(content);
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "Agent files cannot contain credentials or secret values.",
    );
  }
  if (content === version.instructions.trim()) {
    return { saved: false, versionId: version.id };
  }
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await AgentVersionRepository.replaceCurrentVersion({
    version: {
      id: versionId,
      organizationId,
      agentId: agent.id,
      number: await nextNumber(organizationId, agent.id),
      status: "DEPLOYED",
      instructions: content,
      manifest,
      modelId: version.modelId,
      sourceConversationId: version.sourceConversationId,
      createdById: context.userId,
      approvedAt: now,
      deployedAt: now,
    },
    fromVersionId: version.id,
    artifacts: await carriedFiles(organizationId, version.id, versionId, {
      path: INSTRUCTIONS_PATH,
      content: `${content}\n`,
    }),
    audit: {
      organizationId,
      agentId: agent.id,
      versionId,
      actorUserId: context.userId,
      actorType: "USER",
      type: "agent.file.saved",
      summary: `Edited ${INSTRUCTIONS_PATH}`,
      before: { bytes: version.instructions.length },
      after: { bytes: content.length },
      requestId: input.clientRequestId,
    },
  });
  return { saved: true, versionId };
}

export const AgentRevisionService = {
  revise,
  saveInstructions,
};
