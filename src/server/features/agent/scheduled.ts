import { getAgentByName } from "agents";
import { scheduledResearchEnabled } from "@/server/lib/deployment-tier";
import { getOpenRouterFetch } from "@/server/lib/openrouter";
import { runResearchLane, runVisibleLane, type Defer } from "./dispatch";
import { DISPATCH } from "./dispatch/config";
import { reconcileStaleTasks } from "./dispatch/staleTasks";
import { sweepAllBlankFacts } from "./lib/blankFacts";
import type { CrmAgent } from "./CrmAgent";
import type { LeasedTask } from "./repositories/AgentQueueRepository";
import { sessionName } from "./sessionName";

/**
 * The minute cron: the agent's dispatcher. It closes stale tasks, then drains
 * both lanes across every organization (dispatch.ts), and beside them fills
 * fields that went blank from the suggestions waiting on them
 * (lib/blankFacts.ts). It decides nothing on its own: anything that looks
 * like "every N minutes" is a task's `due_at`.
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
  const lanes = await Promise.allSettled([
    runVisibleLane({ signal, defer }),
    runResearchLane({
      signal,
      defer,
      askedForOnly,
      // Without the gateway's binding (or, in dev, a key) no session can run.
      modelConfigured: modelConfigured(env),
      start: (task) => startResearchSession(env, task),
    }),
  ]);
  const [visible, research] = lanes;
  if (visible.status === "fulfilled" && research.status === "fulfilled") {
    if (visible.value + research.value > 0) {
      console.log("[agent] dispatched", {
        visible: visible.value,
        research: research.value,
        askedForOnly,
      });
    }
    return;
  }
  for (const lane of lanes) {
    if (lane.status === "rejected") throw lane.reason;
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
