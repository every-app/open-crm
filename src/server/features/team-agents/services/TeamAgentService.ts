import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { AppError } from "@/server/lib/errors";
import {
  AGENT_ACTION_TYPES,
  agentManifest,
  recordResources,
  SLACK_RESOURCE,
  slackDestinationOf,
  type AgentManifest,
  type RecordResource,
  type TeamAgentStatus,
} from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import {
  TeamAgentRepository,
  type NewArtifact,
  type VersionRow,
} from "../repositories/TeamAgentRepository";
import { canManageAgent, manageableAgent, readableAgent } from "./access";
import { AgentRunService } from "./AgentRunService";
import { assertNoSecrets } from "./draft";

// Team agents after the builder: the agents index and detail, human review
// and deployment of a version, pause, resume, archive, restore and delete,
// and revisions from the detail page. Ported from the CRM's
// agent-definitions.service.ts. Deployment is the approval boundary: saving a
// draft never runs anything; a person deploys an exact version, and its
// triggers alone are enabled from then on.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const INSTRUCTIONS_PATH = "agent/instructions.md";

/** A manifest the review screen can show, or why it can't. */
function readable(manifest: unknown):
  | { readable: true; manifest: AgentManifest }
  | { readable: false; problem: string } {
  const parsed = agentManifest.safeParse(manifest);
  if (parsed.success) return { readable: true, manifest: parsed.data };
  return {
    readable: false,
    problem: parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"} ${issue.message}`)
      .join("; "),
  };
}

/** The agents index: the team's agents and the person's drafts. */
async function list(context: Context) {
  const rows = await TeamAgentRepository.listVisible(
    context.organizationId,
    context.userId,
  );
  const ids = rows.map((row) => row.id);
  const [runs, triggers] = await Promise.all([
    TeamAgentRepository.runCounts(context.organizationId, ids),
    TeamAgentRepository.enabledTriggers(context.organizationId, ids),
  ]);
  return rows.map((row) => {
    const own = triggers.filter((trigger) => trigger.agentId === row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdBy: row.createdByName,
      updatedAt: row.updatedAt,
      runCount: runs.get(row.id) ?? 0,
      trigger: own[0]
        ? { type: own[0].type, name: own[0].name, nextRunAt: own[0].nextRunAt }
        : null,
    };
  });
}

function versionSummary(version: VersionRow) {
  return {
    id: version.id,
    number: version.number,
    status: version.status,
    modelId: version.modelId,
    approvedAt: version.approvedAt,
    deployedAt: version.deployedAt,
    createdAt: version.createdAt,
    sourceConversationId: version.sourceConversationId,
    ...readable(version.manifest),
  };
}

/**
 * An agent's detail: its deployed version, and for a draft the version
 * awaiting review, with the triggers of whichever is shown.
 */
async function get(context: Context, agentId: string) {
  const agent = await readableAgent(context, agentId);
  const { organizationId } = context;
  const [current, latest, runs] = await Promise.all([
    agent.currentVersionId
      ? TeamAgentRepository.findVersion(
          organizationId,
          agent.id,
          agent.currentVersionId,
        )
      : null,
    TeamAgentRepository.latestVersion(organizationId, agent.id),
    TeamAgentRepository.runCounts(organizationId, [agent.id]),
  ]);
  // A draft is reviewed on its newest version; a deployed agent shows what
  // runs, and a newer READY version from its chat waits for review beside it.
  const review =
    latest && latest.status === "READY" && latest.id !== current?.id
      ? latest
      : null;
  const shown = current ?? review;
  const triggers = shown
    ? await TeamAgentRepository.triggersForVersion(organizationId, shown.id)
    : [];
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    createdById: agent.createdById,
    createdBy: agent.createdByName,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    // The builder chat is private: only its owner can open it.
    conversationId:
      agent.createdById === context.userId ? agent.conversationId : null,
    canManage: canManageAgent(context, agent),
    runCount: runs.get(agent.id) ?? 0,
    currentVersion: current ? versionSummary(current) : null,
    reviewVersion: review ? versionSummary(review) : null,
    triggers,
  };
}

/** A version's exact files: the deployed one's, or the one under review. */
async function files(context: Context, agentId: string, versionId: string) {
  const agent = await readableAgent(context, agentId);
  const version = await TeamAgentRepository.findVersion(
    context.organizationId,
    agent.id,
    versionId,
  );
  if (!version) throw new AppError("NOT_FOUND");
  const rows = await TeamAgentRepository.versionFiles(
    context.organizationId,
    version.id,
  );
  return {
    versionId: version.id,
    files: rows.map((row) => ({
      path: row.path,
      language: row.language,
      content: row.content,
      previousContent: row.previousContent,
      revision: row.revision,
    })),
  };
}

async function activity(context: Context, agentId: string, limit: number) {
  const agent = await readableAgent(context, agentId);
  return TeamAgentRepository.listAudit(context.organizationId, agent.id, limit);
}

/**
 * Makes an exact READY (or previously deployed) version live for the team:
 * the human approval step. A replay of the same request returns the same
 * outcome; a request id reused for another version is refused.
 */
async function deploy(
  context: Context,
  input: { agentId: string; versionId: string; clientRequestId: string },
) {
  const agent = await manageableAgent(context, input.agentId);
  const { organizationId } = context;
  const replay = await TeamAgentRepository.findAudit(
    organizationId,
    agent.id,
    "agent.deployed",
    input.clientRequestId,
  );
  if (replay) {
    if (replay.versionId !== input.versionId) {
      throw new AppError("CONFLICT", "That deployment request was already used.");
    }
    return { id: agent.id, versionId: input.versionId, status: "LIVE" as const };
  }
  if (agent.status === "ARCHIVED") {
    throw new AppError("CONFLICT", "Restore the agent before deploying it.");
  }
  const version = await TeamAgentRepository.findVersion(
    organizationId,
    agent.id,
    input.versionId,
  );
  if (!version) throw new AppError("NOT_FOUND");
  const manifest = readable(version.manifest);
  if (!manifest.readable) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This version's manifest is unreadable, so it can't be deployed.",
    );
  }
  const name = manifest.manifest.name.trim() || agent.name;
  const description = manifest.manifest.description.trim() || null;
  try {
    await TeamAgentRepository.deploy({
      organizationId,
      agentId: agent.id,
      versionId: version.id,
      name,
      description,
      audit: {
        organizationId,
        agentId: agent.id,
        versionId: version.id,
        actorUserId: context.userId,
        actorType: "USER",
        type: "agent.deployed",
        summary: `Made version ${version.number} live for the team`,
        before: { status: agent.status },
        after: { status: "LIVE", version: version.number, name },
        requestId: input.clientRequestId,
      },
    });
  } catch (error) {
    // The same request, landed meanwhile: its audit line's key held.
    const landed = await TeamAgentRepository.findAudit(
      organizationId,
      agent.id,
      "agent.deployed",
      input.clientRequestId,
    );
    if (landed?.versionId !== version.id) throw error;
  }
  console.log("[team-agents] deployed", {
    organizationId,
    agentId: agent.id,
    versionId: version.id,
  });
  return { id: agent.id, versionId: version.id, status: "LIVE" as const };
}

const TRANSITIONS = {
  pause: {
    from: ["LIVE"],
    to: "PAUSED",
    type: "agent.paused",
    summary: "Paused agent",
  },
  resume: {
    from: ["PAUSED"],
    to: "LIVE",
    type: "agent.resumed",
    summary: "Resumed agent",
  },
  archive: {
    from: ["LIVE", "PAUSED"],
    to: "ARCHIVED",
    type: "agent.archived",
    summary: "Archived agent",
  },
  restore: {
    from: ["ARCHIVED"],
    to: "PAUSED",
    type: "agent.restored",
    summary: "Restored agent",
  },
} as const satisfies Record<
  string,
  {
    from: readonly TeamAgentStatus[];
    to: TeamAgentStatus;
    type: string;
    summary: string;
  }
>;

/** Pause, resume, archive or restore: a conditional move, then its audit. */
async function transition(
  context: Context,
  agentId: string,
  name: keyof typeof TRANSITIONS,
) {
  const agent = await manageableAgent(context, agentId);
  const step = TRANSITIONS[name];
  const moved = await TeamAgentRepository.transition(
    context.organizationId,
    agent.id,
    step.from,
    step.to,
    name === "archive"
      ? { archivedAt: new Date().toISOString() }
      : name === "restore"
        ? { archivedAt: null }
        : {},
  );
  if (!moved) {
    throw new AppError(
      "CONFLICT",
      `Only a ${step.from.join(" or ").toLowerCase()} agent can be ${name}d.`,
    );
  }
  await TeamAgentRepository.audit({
    organizationId: context.organizationId,
    agentId: agent.id,
    actorUserId: context.userId,
    actorType: "USER",
    type: step.type,
    summary: step.summary,
    before: { status: agent.status },
    after: { status: step.to },
  });
  return moved;
}

/**
 * Deletes an agent: it leaves every list, its triggers stop, and its queued
 * runs are cancelled; its runs, actions and audit stay. A run already going
 * may finish.
 */
async function remove(context: Context, agentId: string) {
  const agent = await manageableAgent(context, agentId);
  const { organizationId } = context;
  const deleted = await TeamAgentRepository.transition(
    organizationId,
    agent.id,
    ["DRAFT", "LIVE", "PAUSED", "ARCHIVED"],
    "DELETED",
    { deletedAt: new Date().toISOString() },
  );
  if (!deleted) throw new AppError("NOT_FOUND");
  const disabledTriggers = await TeamAgentRepository.disableTriggers(
    organizationId,
    agent.id,
  );
  const runs = await AgentRunRepository.listForAgent(organizationId, agent.id, 50);
  let cancelledRuns = 0;
  for (const run of runs) {
    if (run.status !== "QUEUED") continue;
    const cancelled = await AgentRunService.settleRun(organizationId, run.id, {
      status: "CANCELLED",
      code: "AGENT_DELETED",
      message: "The agent was deleted before this run started.",
      actor: { type: "USER", userId: context.userId },
    });
    if (cancelled) cancelledRuns += 1;
  }
  await TeamAgentRepository.audit({
    organizationId,
    agentId: agent.id,
    actorUserId: context.userId,
    actorType: "USER",
    type: "agent.deleted",
    summary: "Deleted agent",
    before: { status: agent.status },
    after: { status: "DELETED", disabledTriggers, cancelledRuns },
  });
  return { id: agent.id, name: agent.name, disabledTriggers, cancelledRuns };
}

/** The deployed version, for a change made from the detail page. */
async function deployedVersion(context: Context, agentId: string) {
  const agent = await manageableAgent(context, agentId);
  if (!agent.currentVersionId) {
    throw new AppError("CONFLICT", "Deploy this agent before changing it.");
  }
  const version = await TeamAgentRepository.findVersion(
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
  const rows = await TeamAgentRepository.versionFiles(organizationId, fromVersionId);
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
  const latest = await TeamAgentRepository.latestVersion(organizationId, agentId);
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
  const replay = await TeamAgentRepository.findAudit(
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
    if (!actions.some((action) => action.type === AGENT_ACTION_TYPES.RUN_SUMMARY)) {
      throw new AppError("VALIDATION_ERROR", "An agent keeps its run summary.");
    }
  }
  const before = slackDestinationOf(manifest);
  if (input.channel) {
    if (!actions.some((action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST)) {
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
    if (manifest.dataScope.mode === "SELECTED" && input.resources.length === 0) {
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
  await TeamAgentRepository.replaceCurrentVersion({
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
    await SlackService.joinChannel(context, input.channel.id).catch(
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
  const replay = await TeamAgentRepository.findAudit(
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
  await TeamAgentRepository.replaceCurrentVersion({
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

export const TeamAgentService = {
  list,
  get,
  files,
  activity,
  deploy,
  transition,
  remove,
  revise,
  saveInstructions,
};
