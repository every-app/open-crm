import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { RunSettlement } from "@/server/features/team-agents/services/RunSettlement";
import { AuditRepository } from "@/server/features/team-agents/repositories/AuditRepository";
import { AgentFileRepository } from "@/server/features/team-agents/repositories/AgentFileRepository";
import { TriggerRepository } from "@/server/features/team-agents/repositories/TriggerRepository";
import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import type { TeamAgentStatus } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import type { VersionRow } from "../repositories/AgentVersionRepository";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";
import { canManageAgent, manageableAgent, readableAgent } from "./access";
import { readable } from "./manifests";
import { joinMovedChannel } from "./revisionVersions";

// Team agents after the builder: the agents index and detail, human review
// and deployment of a version, pause, resume, archive, restore and delete,
// and revisions from the detail page. Ported from the CRM's
// agent-definitions.service.ts. Deployment is the approval boundary: saving a
// draft never runs anything; a person deploys an exact version, and its
// triggers alone are enabled from then on.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const auditJson = z.json().catch(null);

/** The agents index: the team's agents and the person's drafts. */
async function list(context: Context) {
  const rows = await TeamAgentRepository.listVisible(
    context.organizationId,
    context.userId,
  );
  const ids = rows.map((row) => row.id);
  const [runs, triggers] = await Promise.all([
    TeamAgentRepository.runCounts(context.organizationId, ids),
    TriggerRepository.enabledTriggers(context.organizationId, ids),
  ]);
  return rows.map((row) => {
    const own = triggers
      .filter((trigger) => trigger.agentId === row.id)
      .map(({ type, name, nextRunAt }) => ({ type, name, nextRunAt }));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdBy: row.createdByName,
      updatedAt: row.updatedAt,
      runCount: runs.get(row.id) ?? 0,
      trigger: own[0] ?? null,
      triggers: own,
    };
  });
}

function versionSummary(version: VersionRow) {
  return {
    id: version.id,
    number: version.number,
    status: version.status,
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
  // A draft is reviewed on its newest version; a deployed agent shows what
  // runs, and a newer READY version, from its chat or its page, waits for
  // review beside it.
  const [current, review, runs] = await Promise.all([
    agent.currentVersionId
      ? AgentVersionRepository.findVersion(
          organizationId,
          agent.id,
          agent.currentVersionId,
        )
      : null,
    AgentVersionRepository.reviewVersion(
      organizationId,
      agent.id,
      agent.currentVersionId,
    ),
    TeamAgentRepository.runCounts(organizationId, [agent.id]),
  ]);
  const shown = current ?? review;
  const triggers = shown
    ? await TriggerRepository.triggersForVersion(organizationId, shown.id)
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
  const version = await AgentVersionRepository.findVersion(
    context.organizationId,
    agent.id,
    versionId,
  );
  if (!version) throw new AppError("NOT_FOUND");
  const rows = await AgentFileRepository.versionFiles(
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
  const rows = await AuditRepository.listAudit(
    context.organizationId,
    agent.id,
    limit,
  );
  return rows.map((row) => ({
    ...row,
    before: auditJson.parse(row.before),
    after: auditJson.parse(row.after),
  }));
}

/**
 * Renames an agent, or changes its description (null or blank clears it), as
 * the CRM's agents.update. Deploying a version takes that version's name.
 */
async function rename(
  context: Context,
  agentId: string,
  input: { name: string; description?: string | null },
) {
  const agent = await manageableAgent(context, agentId);
  const description =
    input.description === undefined
      ? agent.description
      : input.description || null;
  const changed = await TeamAgentRepository.updateDetails(
    context.organizationId,
    agent.id,
    { name: input.name, description },
  );
  if (!changed) throw new AppError("NOT_FOUND");
  await AuditRepository.audit({
    organizationId: context.organizationId,
    agentId: agent.id,
    actorUserId: context.userId,
    actorType: "USER",
    type: "agent.updated",
    summary: "Changed agent details",
    before: { name: agent.name, description: agent.description },
    after: { name: input.name, description },
  });
  return { id: agent.id, name: input.name, description, status: agent.status };
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
  const replay = await AuditRepository.findAudit(
    organizationId,
    agent.id,
    "agent.deployed",
    input.clientRequestId,
  );
  if (replay) {
    if (replay.versionId !== input.versionId) {
      throw new AppError(
        "CONFLICT",
        "That deployment request was already used.",
      );
    }
    return {
      id: agent.id,
      versionId: input.versionId,
      status: "LIVE" as const,
    };
  }
  if (agent.status === "ARCHIVED") {
    throw new AppError("CONFLICT", "Restore the agent before deploying it.");
  }
  const [version, replaced] = await Promise.all([
    AgentVersionRepository.findVersion(
      organizationId,
      agent.id,
      input.versionId,
    ),
    agent.currentVersionId
      ? AgentVersionRepository.findVersion(
          organizationId,
          agent.id,
          agent.currentVersionId,
        )
      : null,
  ]);
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
    await AgentVersionRepository.deploy({
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
    const landed = await AuditRepository.findAudit(
      organizationId,
      agent.id,
      "agent.deployed",
      input.clientRequestId,
    );
    if (landed?.versionId !== version.id) throw error;
  }
  // A channel move that waited for review joins the channel now.
  const was = replaced ? readable(replaced.manifest) : null;
  await joinMovedChannel(
    context,
    was?.readable ? was.manifest : null,
    manifest.manifest,
  );
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
  await AuditRepository.audit({
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
  const disabledTriggers = await TriggerRepository.disableTriggers(
    organizationId,
    agent.id,
  );
  const runs = await AgentRunRepository.listForAgent(
    organizationId,
    agent.id,
    50,
  );
  let cancelledRuns = 0;
  for (const run of runs) {
    if (run.status !== "QUEUED") continue;
    const cancelled = await RunSettlement.settleRun(organizationId, run.id, {
      status: "CANCELLED",
      code: "AGENT_DELETED",
      message: "The agent was deleted before this run started.",
      actor: { type: "USER", userId: context.userId },
    });
    if (cancelled) cancelledRuns += 1;
  }
  await AuditRepository.audit({
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

export const TeamAgentService = {
  list,
  get,
  files,
  activity,
  rename,
  deploy,
  transition,
  remove,
};
