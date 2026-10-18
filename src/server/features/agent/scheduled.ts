import { getAgentByName } from "agents";
import { laneCreditCheck } from "@/server/billing/credits";
import { scheduledResearchEnabled } from "@/server/lib/deployment-tier";
import { getOpenRouterFetch } from "@/server/lib/openrouter";
import { hasContextAccess } from "@/server/lib/provider-access";
import { runResearchLane, runVisibleLane, type Defer } from "./dispatch";
import { DISPATCH } from "./dispatch/config";
import { reconcileStaleTasks } from "./dispatch/staleTasks";
import { runEnrichmentSweep } from "./dispatch/sweep";
import { sweepAllBlankFacts } from "./lib/blankFacts";
import type { CrmAgent } from "./CrmAgent";
import type { LeasedTask } from "./repositories/AgentQueueRepository";
import {
  DispatchHealthRepository,
  type LaneName,
} from "./repositories/DispatchHealthRepository";
import { sessionName } from "./sessionName";
import { runTeamAgentLane } from "@/server/features/team-agents/runtime/dispatch";

/**
 * The minute cron: the agent's dispatcher. It closes stale tasks, then drains
 * both lanes across every organization (dispatch.ts) and the team agents'
 * runs, and sweeps a few organizations' records for work to queue
 * (dispatch/sweep.ts). Beside them it fills fields that went blank from the
 * suggestions waiting on them (lib/blankFacts.ts). It decides nothing else on
 * its own: anything that looks like "every N minutes" is a task's `due_at`.
 * When each lane ran is kept for the health check (src/server/features/health).
 */
export async function runScheduledWork(
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const defer: Defer = (work) =>
    ctx.waitUntil(
      work.catch((error: unknown) => {
        console.error("[agent] late dispatch work failed", error);
      }),
    );
  defer(sweepAllBlankFacts());
  await reconcileStaleTasks();
  const signal = AbortSignal.timeout(DISPATCH.sweep.timeoutMs);
  const askedForOnly = !scheduledResearchEnabled(env);
  // Where usage is billed, organizations out of credits wait.
  const credits = laneCreditCheck(env);
  const lanes: { lane: LaneName; run: Promise<number> }[] = [
    { lane: "visible", run: runVisibleLane({ signal, defer, credits }) },
    {
      lane: "runs",
      // Team agents' runs: their schedules are unattended spending, held
      // with the scheduled research.
      run: runTeamAgentLane(env, {
        signal,
        defer,
        holdUnattended: askedForOnly,
        credits,
      }),
    },
    {
      lane: "research",
      run: runResearchLane({
        signal,
        defer,
        askedForOnly,
        credits,
        // Without the gateway's binding (or, in dev, a key) no session can run.
        modelConfigured: modelConfigured(env),
        start: (task) => startResearchSession(env, task),
      }),
    },
  ];
  // The enrichment sweep queues scheduled research: held with it.
  if (!askedForOnly) {
    lanes.push({
      lane: "sweep",
      run: runEnrichmentSweep({
        signal,
        credits,
        contextReady: hasContextAccess,
      }),
    });
  }
  const passes = await Promise.all(
    lanes.map(async ({ lane, run }) => {
      try {
        return { lane, handled: await run, failure: null };
      } catch (error) {
        return { lane, handled: 0, failure: { error } };
      }
    }),
  );
  await DispatchHealthRepository.recordLanes(
    passes.map(({ lane, handled, failure }) => ({
      lane,
      handled,
      failed: failure !== null,
    })),
  ).catch((error: unknown) => {
    console.error("[agent] could not note when the lanes ran", error);
  });
  const failed = passes.find((pass) => pass.failure !== null);
  if (failed?.failure) throw failed.failure.error;
  if (passes.some((pass) => pass.handled > 0)) {
    console.log("[agent] dispatched", {
      ...Object.fromEntries(passes.map((pass) => [pass.lane, pass.handled])),
      askedForOnly,
    });
  }
}

/**
 * Starts the task's research session in its own CrmAgent, named for the task
 * and its organization. The agent accepts the turn durably and returns at
 * once; the session reports back when it ends.
 */
async function startResearchSession(
  env: Env,
  task: LeasedTask,
): Promise<{ sessionId: string }> {
  const agent = await getAgentByName(
    crmAgentNamespace(env),
    sessionName("task", task.organizationId, task.id),
  );
  return agent.startResearch({
    taskId: task.id,
    attempts: task.attempts,
    lease: task.leasedUntil,
  });
}

/**
 * Whether this deployment has a way to a model at all: the gateway binding
 * (or, in dev, a key). The fetch is only built, never called, so the
 * organization it names is a placeholder.
 */
function modelConfigured(env: Env): boolean {
  return getOpenRouterFetch(env, "model-check") !== null;
}

/**
 * The CRM_AGENT binding with its class. everyAppWorker() declares Durable
 * Object bindings without naming their class, so the generated Env types it
 * DurableObjectNamespace<undefined>; everyapp.config.ts binds it to CrmAgent.
 */
function crmAgentNamespace(env: Env): DurableObjectNamespace<CrmAgent> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  return env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
}
