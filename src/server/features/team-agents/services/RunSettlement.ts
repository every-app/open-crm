import { RunEventRepository } from "@/server/features/team-agents/repositories/RunEventRepository";
import { modelUnavailable } from "@/server/features/agent/runtime/research";
import { sessionName } from "@/server/features/agent/sessionName";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_ACTION_TYPES,
  agentManifest,
  type TriggerType,
} from "@/shared/team-agents";
import { AgentActionRepository } from "../repositories/AgentActionRepository";
import { AgentRunRepository } from "../repositories/AgentRunRepository";

// How a team agent's run ends, ported from the CRM's run settlement
// (custom-agent-dispatch.ts failRun/cancelRun, run-runtime.ts finishRun). A
// run ends exactly once, by a conditional write on its row; whoever wins it
// records the ending: the terminal event, its outstanding actions cancelled
// when it was stopped, and the audit line.

export const MODEL_UNAVAILABLE = {
  code: "MODEL_UNAVAILABLE",
  message:
    "The agent's model is not available on this install: the Every App gateway holds no OPENROUTER_API_KEY (in local development, set it in .dev.vars).",
} as const;

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
  await RunEventRepository.recordEnding({
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
    const actions = await AgentActionRepository.actionsForRuns(organizationId, [
      run.id,
    ]);
    for (const declared of externalActions(run.manifest)) {
      const rows = actions.filter((action) => action.type === declared.type);
      if (rows.some((action) => action.status === "SUCCEEDED")) continue;
      const failure = rows
        .filter((action) => action.status === "FAILED")
        .at(-1);
      const code = failure?.errorCode ?? "ACTION_NOT_PERFORMED";
      const message =
        failure?.errorMessage ??
        `The declared ${declared.type} action was not performed.`;
      if (rows.length === 0) {
        await AgentActionRepository.planAction({
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

/**
 * A run's session turn ended (CrmAgent.onSubmissionStatus): completed, it
 * finishes; failed, it fails with why; stopped or skipped, it is cancelled.
 */
async function endTurn(
  organizationId: string,
  runId: string,
  ending: { status: string; error?: string },
): Promise<void> {
  if (ending.status === "completed") {
    await finishRun(organizationId, runId);
    return;
  }
  if (ending.status === "error") {
    const error = ending.error ?? "The agent turn failed.";
    await (modelUnavailable(error)
      ? failRun(
          organizationId,
          runId,
          MODEL_UNAVAILABLE.code,
          MODEL_UNAVAILABLE.message,
        )
      : failRun(organizationId, runId, "TURN_FAILED", error));
    return;
  }
  await settleRun(organizationId, runId, {
    status: "CANCELLED",
    code: "CANCELLED",
    message: "The run was stopped before it finished.",
    actor: { type: "AGENT" },
  });
}

export const RunSettlement = {
  endTurn,
  settleRun,
  failRun,
  finishRun,
  noActionRefusal,
};
