import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import { sessionName } from "@/server/features/agent/sessionName";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_ACTION_TYPES,
  agentManifest,
  TEAM_AGENT_LIMITS,
  type TriggerType,
} from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { TeamAgentRepository } from "../repositories/TeamAgentRepository";
import { canManageAgent, readableAgent } from "./access";

// A team agent's runs, ported from the CRM's agent-runs.service.ts and the
// run settlement in its agent worker (custom-agent-dispatch.ts,
// run-runtime.ts). A run is queued here, started by the dispatcher
// (runtime/dispatch.ts) in a CrmAgent session, and ended exactly once by a
// conditional write on its row (`settle`): whoever wins that write records
// the ending. The row is what stops the work: every runner tool refuses a run
// that is not RUNNING, so a stop that never reaches the session still means
// nothing more is written.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const DAY_MS = 86_400_000;

export const RUN_ERRORS = {
  cancelled: {
    code: "CANCELLED",
    message: "Stopped by a person before it finished.",
  },
  limit: {
    code: "RUN_LIMIT",
    message: `Skipped: this agent already started ${TEAM_AGENT_LIMITS.maxRunsPerDay} runs in the last 24 hours.`,
  },
} as const;

export const MODEL_UNAVAILABLE = {
  code: "MODEL_UNAVAILABLE",
  message:
    "The agent's model is not available on this install: the Every App gateway holds no OPENROUTER_API_KEY (in local development, set it in .dev.vars).",
} as const;

/** Whether the agent may be given another run today. */
async function underDailyCap(
  organizationId: string,
  agentId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const runs = await AgentRunRepository.countSince(organizationId, agentId, since);
  return runs < TEAM_AGENT_LIMITS.maxRunsPerDay;
}

/**
 * Queues a run, once per idempotency key: the shared path of a person's
 * request, a due schedule and a matched event. Null when the agent is at its
 * daily cap (the trigger's run is skipped, and the skip audited).
 */
async function queueRun(input: {
  organizationId: string;
  agentId: string;
  versionId: string;
  triggerId: string | null;
  triggerType: TriggerType;
  initiatedById: string | null;
  idempotencyKey: string;
  runInput: unknown;
  requestedSummary: string;
}): Promise<{ id: string; created: boolean } | null> {
  const { organizationId, agentId } = input;
  const existing = await AgentRunRepository.findByKey(
    organizationId,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.agentId !== agentId) {
      throw new AppError("CONFLICT", "That run request was already used.");
    }
    return { id: existing.id, created: false };
  }
  if (!(await underDailyCap(organizationId, agentId))) {
    await TeamAgentRepository.audit({
      organizationId,
      agentId,
      versionId: input.versionId,
      actorUserId: input.initiatedById,
      actorType: input.initiatedById ? "USER" : "SYSTEM",
      type: "run.skipped",
      summary: RUN_ERRORS.limit.message,
      requestId: input.idempotencyKey,
    });
    return null;
  }
  const run = await AgentRunRepository.insertIfAbsent({
    organizationId,
    agentId,
    versionId: input.versionId,
    triggerId: input.triggerId,
    initiatedById: input.initiatedById,
    triggerType: input.triggerType,
    idempotencyKey: input.idempotencyKey,
    input: input.runInput,
  });
  if (run.created) {
    await AgentRunRepository.insertEvent({
      organizationId,
      sessionId: sessionName("run", organizationId, run.id),
      type: "run.queued",
      data: { summary: input.requestedSummary, triggerType: input.triggerType },
    });
    await TeamAgentRepository.audit({
      organizationId,
      agentId,
      versionId: input.versionId,
      actorUserId: input.initiatedById,
      actorType: input.initiatedById ? "USER" : "SYSTEM",
      type: "run.requested",
      summary: input.requestedSummary,
      requestId: input.idempotencyKey,
    });
  }
  return run;
}

/** A live agent the person may see, for a run request. */
async function liveAgent(context: Context, agentId: string) {
  const agent = await readableAgent(context, agentId);
  if (agent.status !== "LIVE" || !agent.currentVersionId) {
    throw new AppError("TEAM_AGENT_NOT_LIVE");
  }
  return { ...agent, currentVersionId: agent.currentVersionId };
}

/** A person asks the agent to run now. */
async function runNow(
  context: Context,
  input: { agentId: string; clientRequestId: string },
): Promise<{ id: string }> {
  const replay = await AgentRunRepository.findByKey(
    context.organizationId,
    input.clientRequestId,
  );
  if (replay) {
    if (replay.agentId !== input.agentId) {
      throw new AppError("CONFLICT", "That run request was already used.");
    }
    return { id: replay.id };
  }
  const agent = await liveAgent(context, input.agentId);
  if (await AgentRunRepository.hasActiveRun(context.organizationId, agent.id)) {
    throw new AppError("TEAM_AGENT_BUSY");
  }
  const run = await queueRun({
    organizationId: context.organizationId,
    agentId: agent.id,
    versionId: agent.currentVersionId,
    triggerId: null,
    triggerType: "MANUAL",
    initiatedById: context.userId,
    idempotencyKey: input.clientRequestId,
    runInput: null,
    requestedSummary: "Requested a manual run",
  });
  if (!run) throw new AppError("TEAM_AGENT_RUN_LIMIT");
  return { id: run.id };
}

/** Runs an ended run again: the same version, trigger and input. */
async function retryRun(
  context: Context,
  input: { agentId: string; runId: string; clientRequestId: string },
): Promise<{ id: string }> {
  const agent = await liveAgent(context, input.agentId);
  const previous = await AgentRunRepository.findById(
    context.organizationId,
    input.runId,
  );
  if (!previous || previous.agentId !== agent.id) {
    throw new AppError("NOT_FOUND");
  }
  if ((ACTIVE_RUN_STATUSES as readonly string[]).includes(previous.status)) {
    throw new AppError("CONFLICT", "This run has not finished yet.");
  }
  const replay = await AgentRunRepository.findByKey(
    context.organizationId,
    input.clientRequestId,
  );
  if (!replay && (await AgentRunRepository.hasActiveRun(context.organizationId, agent.id))) {
    throw new AppError("TEAM_AGENT_BUSY");
  }
  const run = await queueRun({
    organizationId: context.organizationId,
    agentId: agent.id,
    versionId: previous.versionId,
    triggerId: previous.triggerId,
    triggerType: previous.triggerType,
    initiatedById: context.userId,
    idempotencyKey: input.clientRequestId,
    runInput: previous.input,
    requestedSummary: "Retried a run",
  });
  if (!run) throw new AppError("TEAM_AGENT_RUN_LIMIT");
  return { id: run.id };
}

/**
 * Stops a run: the person who started it, the agent's creator, or an owner
 * or admin. The run settles to CANCELLED here, with its outstanding actions;
 * what it already did stays done. True when this call stopped it.
 */
async function cancelRun(
  context: Context,
  input: { agentId: string; runId: string },
): Promise<{ cancelled: boolean; sessionId: string | null }> {
  const agent = await readableAgent(context, input.agentId);
  const run = await AgentRunRepository.findById(
    context.organizationId,
    input.runId,
  );
  if (!run || run.agentId !== agent.id) throw new AppError("NOT_FOUND");
  if (!canManageAgent(context, agent) && run.initiatedById !== context.userId) {
    throw new AppError("FORBIDDEN");
  }
  const settled = await settleRun(context.organizationId, run.id, {
    status: "CANCELLED",
    ...RUN_ERRORS.cancelled,
    actor: { type: "USER", userId: context.userId },
  });
  return { cancelled: settled, sessionId: run.sessionId };
}

type Actor = { type: "USER"; userId: string } | { type: "AGENT" | "SYSTEM" };

/**
 * Ends a queued or running run as `status`, once. The winner of the
 * conditional write records the terminal event, cancels outstanding actions
 * (when stopped) and audits it. True when this call ended it.
 */
async function settleRun(
  organizationId: string,
  runId: string,
  input: {
    status: "SUCCEEDED" | "FAILED" | "CANCELLED";
    code?: string;
    message: string;
    summary?: string;
    actor: Actor;
  },
): Promise<boolean> {
  const run = await AgentRunRepository.settle(organizationId, runId, {
    from: ACTIVE_RUN_STATUSES,
    status: input.status,
    errorCode: input.status === "SUCCEEDED" ? null : (input.code ?? null),
    errorMessage: input.status === "SUCCEEDED" ? null : input.message,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
  });
  if (!run) return false;
  const type =
    input.status === "SUCCEEDED"
      ? ("run.completed" as const)
      : input.status === "FAILED"
        ? ("run.failed" as const)
        : ("run.cancelled" as const);
  await AgentRunRepository.recordEnding({
    organizationId,
    runId,
    sessionId: sessionName("run", organizationId, runId),
    type,
    data:
      input.status === "SUCCEEDED"
        ? { summary: input.message }
        : { code: input.code ?? null, summary: input.message },
    cancelActions:
      input.status === "SUCCEEDED"
        ? null
        : { code: input.code ?? input.status, message: input.message },
    audit: {
      organizationId,
      agentId: run.agentId,
      versionId: run.versionId,
      actorUserId: input.actor.type === "USER" ? input.actor.userId : null,
      actorType: input.actor.type,
      type,
      summary:
        input.status === "CANCELLED" && input.actor.type === "USER"
          ? "Stopped a run"
          : input.message,
      requestId: runId,
    },
  });
  console.log("[team-agents] run ended", {
    organizationId,
    runId,
    status: input.status,
    code: input.code ?? null,
  });
  return true;
}

/** The run failed: why, in words a person reads in the runs drawer. */
async function failRun(
  organizationId: string,
  runId: string,
  code: string,
  message: string,
): Promise<boolean> {
  return settleRun(organizationId, runId, {
    status: "FAILED",
    code,
    message,
    actor: { type: "AGENT" },
  });
}

const NO_ACTION_TRIGGERS = new Set<TriggerType>(["EVENT", "SCHEDULE"]);

function externalActions(manifest: unknown) {
  const parsed = agentManifest.safeParse(manifest);
  return parsed.success
    ? parsed.data.actions.filter(
        (action) => action.type !== AGENT_ACTION_TYPES.RUN_SUMMARY,
      )
    : [];
}

/**
 * Why a run may not end with "no action needed": a person ran it by hand and
 * its version declares an action, so the action was the point.
 */
function noActionRefusal(
  triggerType: TriggerType,
  manifest: unknown,
): string | null {
  if (NO_ACTION_TRIGGERS.has(triggerType)) return null;
  if (externalActions(manifest).length === 0) return null;
  return `This ${triggerType.toLowerCase()} run cannot end with no action needed, because its agent declares an action. Perform the declared action, or report why it failed.`;
}

/**
 * The session finished: the run succeeds with its staged summary, unless a
 * declared action never succeeded (and the run didn't rightly report that
 * none was needed), in which case it fails with that action's reason.
 */
async function finishRun(organizationId: string, runId: string): Promise<void> {
  const run = await AgentRunRepository.findWithVersion(organizationId, runId);
  if (run?.status !== "RUNNING") return;
  const summary = run.summary ?? "The agent run completed.";
  const noActionAccepted =
    run.noActionNeeded !== null &&
    noActionRefusal(run.triggerType, run.manifest) === null;
  if (!noActionAccepted) {
    const actions = await AgentRunRepository.actionsForRuns(organizationId, [
      run.id,
    ]);
    for (const declared of externalActions(run.manifest)) {
      const rows = actions.filter((action) => action.type === declared.type);
      if (rows.some((action) => action.status === "SUCCEEDED")) continue;
      const failure = [...rows]
        .reverse()
        .find((action) => action.status === "FAILED");
      const code = failure?.errorCode ?? "ACTION_NOT_PERFORMED";
      const message =
        failure?.errorMessage ??
        `The declared ${declared.type} action was not performed.`;
      if (rows.length === 0) {
        await AgentRunRepository.planAction({
          organizationId,
          agentId: run.agentId,
          runId: run.id,
          type: declared.type,
          provider: declared.provider,
          targetType: null,
          targetId: null,
          targetLabel: null,
          summary: declared.summary || `Declared ${declared.type}`,
          metadata: null,
          idempotencyKey: `run:${run.id}:required:${declared.type}`,
          requestHash: "required",
          status: "FAILED",
          errorCode: code,
          errorMessage: message,
        });
      }
      await failRun(organizationId, run.id, code, message);
      return;
    }
  }
  await settleRun(organizationId, run.id, {
    status: "SUCCEEDED",
    message: summary,
    summary,
    actor: { type: "AGENT" },
  });
}

const runEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.json().catch(null),
  emittedAt: z.string(),
});

const RUN_EVENT_LIMIT = 200;

/** The agent's runs for the drawer: each with its steps and its actions. */
async function history(context: Context, agentId: string, limit: number) {
  const agent = await readableAgent(context, agentId);
  const { organizationId } = context;
  const runs = await AgentRunRepository.listForAgent(
    organizationId,
    agent.id,
    limit,
  );
  const sessions = runs.map((run) => sessionName("run", organizationId, run.id));
  const [events, actions] = await Promise.all([
    AgentRunRepository.eventsForSessions(organizationId, sessions),
    AgentRunRepository.actionsForRuns(
      organizationId,
      runs.map((run) => run.id),
    ),
  ]);
  const manage = canManageAgent(context, agent);
  return runs.map((run) => {
    const session = sessionName("run", organizationId, run.id);
    const steps = events.filter((event) => event.sessionId === session);
    return {
      id: run.id,
      status: run.status,
      triggerType: run.triggerType,
      summary: run.summary,
      noActionNeeded: run.noActionNeeded,
      modelId: run.modelId,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      initiatedBy: run.initiatedByName,
      versionNumber: run.versionNumber,
      canCancel:
        (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status) &&
        (manage || run.initiatedById === context.userId),
      totalEvents: steps.length,
      events: steps.slice(0, RUN_EVENT_LIMIT).map((event) =>
        runEvent.parse(event),
      ),
      actions: actions
        .filter((action) => action.runId === run.id)
        .map(({ metadata: _metadata, requestHash: _hash, ...action }) => action),
    };
  });
}

export const AgentRunService = {
  queueRun,
  runNow,
  retryRun,
  cancelRun,
  settleRun,
  failRun,
  finishRun,
  noActionRefusal,
  history,
};
