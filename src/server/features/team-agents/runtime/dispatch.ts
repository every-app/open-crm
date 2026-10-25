import { RunEventRepository } from "@/server/features/team-agents/repositories/RunEventRepository";
import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import { RunSettlement } from "@/server/features/team-agents/services/RunSettlement";
import { RunQueueRepository } from "@/server/features/team-agents/repositories/RunQueueRepository";
import { getAgentByName } from "agents";
import { settledWithin } from "@/server/features/agent/dispatch/pool";
import type { CrmAgent } from "@/server/features/agent/CrmAgent";
import { sessionName } from "@/server/features/agent/sessionName";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { agentModelId, getGatewayFetch } from "@/server/lib/gateway-ai";
import { AGENT_ACTION_TYPES, agentManifest } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { MODEL_UNAVAILABLE } from "../services/RunSettlement";
import { TriggerService } from "../services/TriggerService";

// The team agents' lane of the minute cron, ported from the CRM's
// drainAgentRuns: it settles runs that overran or never got going, queues
// due schedules and the runs of queued CRM events, then starts queued runs,
// one at a time per agent, each in its own CrmAgent session
// (`run.<organization>.<run id>`). A person's "Run now", and the runs a
// record write's events queued, poke it for their organization at once. A
// run that can't run (no model on the gateway, Slack not connected) fails
// with the reason instead of waiting. Organizations take turns, each at most RUNS.perOrganization runs a tick.
// The per-minute scans are a few indexed queries whatever the number of
// organizations.

const MINUTE_MS = 60_000;

const RUNS = {
  batch: 20,
  /** Runs an organization may start a tick, so organizations take turns. */
  perOrganization: 5,
  /** A delivered run that hasn't finished in this long is stopped. */
  executionTimeoutMs: 20 * MINUTE_MS,
  /** A claimed run whose session never accepted it goes back to the queue. */
  deliveryLeaseMs: 5 * MINUTE_MS,
  startTimeoutMs: MINUTE_MS,
} as const;

type Defer = (work: Promise<unknown>) => void;

function crmAgents(env: Env): DurableObjectNamespace<CrmAgent> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  return env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
}

async function runAgent(env: Env, organizationId: string, runId: string) {
  return getAgentByName(
    crmAgents(env),
    sessionName("run", organizationId, runId),
  );
}

/** Asks a run's session to stop spending: the row already stopped it. */
export async function stopRunSession(
  env: Env,
  organizationId: string,
  runId: string,
): Promise<void> {
  const agent = await runAgent(env, organizationId, runId);
  await agent.stopRun({ runId });
}

/** Settles runs that overran, and returns undelivered ones to the queue. */
async function recover(env: Env, defer: Defer): Promise<void> {
  const now = Date.now();
  const overran = await RunQueueRepository.runningSince(
    new Date(now - RUNS.executionTimeoutMs).toISOString(),
    true,
    RUNS.batch,
  );
  for (const run of overran) {
    const failed = await RunSettlement.failRun(
      run.organizationId,
      run.id,
      "RUN_TIMED_OUT",
      `This run passed ${RUNS.executionTimeoutMs / MINUTE_MS} minutes without finishing and was stopped.`,
    );
    if (failed) defer(stopRunSession(env, run.organizationId, run.id));
  }
  const undelivered = await RunQueueRepository.runningSince(
    new Date(now - RUNS.deliveryLeaseMs).toISOString(),
    false,
    RUNS.batch,
  );
  for (const run of undelivered) {
    await AgentRunRepository.requeue(run.organizationId, run.id);
  }
  const orphaned = await RunQueueRepository.queuedOfStoppedAgents(RUNS.batch);
  for (const run of orphaned) {
    await RunSettlement.settleRun(run.organizationId, run.id, {
      status: "CANCELLED",
      code: "AGENT_UNAVAILABLE",
      message: `The agent was ${run.agentStatus.toLowerCase()} before this run started.`,
      actor: { type: "SYSTEM" },
    });
  }
}

/** Why a queued run can't start on this install, or null. */
async function cannotStart(
  env: Env,
  run: { organizationId: string; agentId: string; versionId: string },
): Promise<{ code: string; message: string } | null> {
  if (getGatewayFetch(env, run.organizationId) === null) {
    return MODEL_UNAVAILABLE;
  }
  const version = await AgentVersionRepository.findVersion(
    run.organizationId,
    run.agentId,
    run.versionId,
  );
  const manifest = agentManifest.safeParse(version?.manifest);
  if (!manifest.success) {
    return {
      code: "INVALID_MANIFEST",
      message:
        "This version's manifest is unreadable, so it cannot run. Revise and deploy the agent again.",
    };
  }
  const postsToSlack = manifest.data.actions.some(
    (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
  );
  if (postsToSlack && !(await SlackService.isConnected(run.organizationId))) {
    return {
      code: "DEPENDENCY_UNAVAILABLE",
      message:
        "This agent cannot run yet. Connect Slack in Settings → Connections.",
    };
  }
  return null;
}

/** Claims a queued run and hands it to its session. */
async function start(
  env: Env,
  run: {
    id: string;
    organizationId: string;
    agentId: string;
    versionId: string;
  },
  defer: Defer,
): Promise<boolean> {
  const blocked = await cannotStart(env, run);
  if (blocked) {
    await RunSettlement.failRun(
      run.organizationId,
      run.id,
      blocked.code,
      blocked.message,
    );
    return false;
  }
  const sessionId = sessionName("run", run.organizationId, run.id);
  // The run records the model it ran on, for its history.
  const claimed = await AgentRunRepository.claim(
    run.organizationId,
    run.id,
    await agentModelId(),
  );
  if (!claimed) return false;
  await RunEventRepository.insertEvent({
    organizationId: run.organizationId,
    sessionId,
    type: "run.started",
    data: { summary: "Started" },
  });
  // The session accepts the turn durably and returns at once; a slow
  // answer is reconciled after the tick rather than failed.
  const handed = runAgent(env, run.organizationId, run.id)
    .then((agent) => agent.startRun({ runId: run.id }))
    .then(
      () =>
        AgentRunRepository.setSession(run.organizationId, run.id, sessionId),
      async (error: unknown) => {
        await RunSettlement.failRun(
          run.organizationId,
          run.id,
          "DELIVERY_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
  const outcome = await settledWithin(handed, RUNS.startTimeoutMs);
  if (!outcome.settled) defer(handed);
  return true;
}

/**
 * The lane: recover, queue due schedules and the runs of queued CRM events,
 * then start what is queued, across organizations or, for a poke, one. How
 * many runs it started.
 */
export async function runTeamAgentLane(
  env: Env,
  options: {
    defer: Defer;
    organizationId?: string;
    signal?: AbortSignal;
  },
): Promise<number> {
  if (!options.organizationId) {
    await recover(env, options.defer);
    await TriggerService.queueDueSchedules();
    await TriggerService.queueEventRuns();
  }
  if (options.signal?.aborted) return 0;
  const queued = await RunQueueRepository.queuedAcrossOrganizations({
    limit: RUNS.batch,
    perOrganization: options.organizationId ? RUNS.batch : RUNS.perOrganization,
    organizationId: options.organizationId,
  });
  let started = 0;
  for (const run of queued) {
    if (options.signal?.aborted) break;
    const ok = await forOrganization(run.organizationId, () =>
      start(env, run, options.defer).catch((error: unknown) => {
        console.error(
          "[team-agents] run did not start",
          { runId: run.id },
          error,
        );
        return false;
      }),
    );
    if (ok) started += 1;
  }
  return started;
}
