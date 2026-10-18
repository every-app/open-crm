import { RunEventRepository } from "@/server/features/team-agents/repositories/RunEventRepository";
import { AgentActionRepository } from "@/server/features/team-agents/repositories/AgentActionRepository";
import { AuditRepository } from "@/server/features/team-agents/repositories/AuditRepository";
import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { backgroundCredits, requireCredits } from "@/server/billing/credits";
import { AppError } from "@/server/lib/errors";
import { sessionName } from "@/server/features/agent/sessionName";
import { ACTIVE_RUN_STATUSES, type TriggerType } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { canManageAgent, readableAgent } from "./access";
import { RunSettlement } from "./RunSettlement";

// A team agent's runs, ported from the CRM's agent-runs.service.ts and the
// run settlement in its agent worker (custom-agent-dispatch.ts,
// run-runtime.ts). A run is queued here, started by the dispatcher
// (runtime/dispatch.ts) in a CrmAgent session, and ended exactly once by a
// conditional write on its row (`settle`): whoever wins that write records
// the ending. The row is what stops the work: every runner tool refuses a run
// that is not RUNNING, so a stop that never reaches the session still means
// nothing more is written.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const RUN_ERRORS = {
  cancelled: {
    code: "CANCELLED",
    message: "Stopped by a person before it finished.",
  },
  credits: { message: "Skipped: the workspace is out of credits." },
} as const;

/**
 * Queues a run, once per idempotency key: the shared path of a person's
 * request, a due schedule and a matched event. Null when a schedule's or an
 * event's run finds the workspace out of credits (the trigger's run is
 * skipped, and the skip audited).
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
  if (!input.initiatedById && !(await backgroundCredits(organizationId))) {
    await AuditRepository.audit({
      organizationId,
      agentId,
      versionId: input.versionId,
      actorType: "SYSTEM",
      type: "run.skipped",
      summary: RUN_ERRORS.credits.message,
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
    await RunEventRepository.insertEvent({
      organizationId,
      sessionId: sessionName("run", organizationId, run.id),
      type: "run.queued",
      data: { summary: input.requestedSummary, triggerType: input.triggerType },
    });
    await AuditRepository.audit({
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
  await requireCredits({ organizationId: context.organizationId });
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
  if (!run) throw new AppError("INSUFFICIENT_CREDITS");
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
  if (
    !replay &&
    (await AgentRunRepository.hasActiveRun(context.organizationId, agent.id))
  ) {
    throw new AppError("TEAM_AGENT_BUSY");
  }
  if (!replay) await requireCredits({ organizationId: context.organizationId });
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
  if (!run) throw new AppError("INSUFFICIENT_CREDITS");
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
  const settled = await RunSettlement.settleRun(
    context.organizationId,
    run.id,
    {
      status: "CANCELLED",
      ...RUN_ERRORS.cancelled,
      actor: { type: "USER", userId: context.userId },
    },
  );
  return { cancelled: settled, sessionId: run.sessionId };
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
  const sessions = runs.map((run) =>
    sessionName("run", organizationId, run.id),
  );
  const [events, actions] = await Promise.all([
    RunEventRepository.eventsForSessions(organizationId, sessions),
    AgentActionRepository.actionsForRuns(
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
      events: steps
        .slice(0, RUN_EVENT_LIMIT)
        .map((event) => runEvent.parse(event)),
      actions: actions
        .filter((action) => action.runId === run.id)
        .map(
          ({ metadata: _metadata, requestHash: _hash, ...action }) => action,
        ),
    };
  });
}

export const AgentRunService = {
  queueRun,
  runNow,
  retryRun,
  cancelRun,
  history,
};
