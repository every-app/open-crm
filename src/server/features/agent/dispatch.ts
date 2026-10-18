import { creditsHeldSince } from "@/server/billing/creditReading";
import type { CreditCheck } from "@/server/billing/credits";
import { billResearchSpend } from "@/server/billing/researchSpend";
import { withSpendSink, type ProviderSpend } from "@/server/billing/spendSink";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { SlackSyncService } from "@/server/features/slack/services/SlackSyncService";
import {
  AGENT_EVENT_KIND,
  ASKED_FOR_PRIORITY,
  DIRECT_KINDS,
  FREE_KINDS,
  SLACK_SYNC_KIND,
} from "@/shared/agent-tasks";
import { DISPATCH } from "./dispatch/config";
import { markRunning, settle } from "./dispatch/enrichment";
import { runLimited, settledWithin } from "./dispatch/pool";
import {
  AgentQueueRepository,
  type LeasedTask,
} from "./repositories/AgentQueueRepository";
import { AgentTaskRepository } from "./repositories/AgentTaskRepository";
import { FREE } from "./runtime/budget";
import { MODEL_RETRY_MS } from "./services/AgentAvailabilityService";
import { brandOutcome, runBrand, storeFavicon } from "./visible/brand";
import { runPortrait } from "./visible/portrait";

// The research agent's dispatcher, ported from the CRM's lib/dispatch.ts. The
// queue (agent_task) says what the work is; the lane only says whether it
// needs a conversation:
//
// - The visible lane (brand, portrait, the Slack inventory) has nothing to
//   decide, so it runs here with no model: many at once, on a short lease,
//   first. Through a session it queued behind sixty research runs. A brand
//   that leaves the company without an icon falls back on the company's own
//   favicon, which is free. A read of Slack goes a few pages a run, each run
//   going on from where the last stopped (SlackSyncService).
// - The research lane starts one CrmAgent session per task, on a lease long
//   enough for the session to finish and report back (CrmAgent).
//
// CRM events (agent-event) are neither: the team-agent lane turns them into
// runs (TriggerService).
//
// Every gateway call is the task's organization's (forOrganization). A task
// that fails is retried when its lease runs out, up to MAX_ATTEMPTS, then
// retired by the stale-task sweep. Where usage is billed, both lanes leave an
// organization out of credits waiting (`credits`, billing/credits.ts), but for
// work that costs nothing (FREE_KINDS).

/** Work that outlives the call that started it (ctx.waitUntil). */
export type Defer = (work: Promise<unknown>) => void;

/** Starts a research session for a task: its session id once accepted. */
type ResearchStart = (task: LeasedTask) => Promise<{ sessionId: string }>;

/**
 * Runs due brand and portrait tasks, `concurrency` at a time, up to the
 * lane's batch: across organizations, or one organization's for a poke.
 */
export async function runVisibleLane(options: {
  organizationId?: string;
  signal?: AbortSignal;
  defer: Defer;
  credits?: CreditCheck;
}): Promise<number> {
  const { batch, concurrency, leaseMs } = DISPATCH.visible;
  let handled = 0;
  while (handled < batch && !options.signal?.aborted) {
    const tasks = await AgentQueueRepository.claimDue({
      limit: Math.min(concurrency, batch - handled),
      lane: { only: DIRECT_KINDS },
      leaseMs,
      organizationId: options.organizationId,
      creditsHeldSince: options.credits ? creditsHeldSince() : undefined,
    });
    if (tasks.length === 0) break;
    await runLimited(
      concurrency,
      await withCredits(tasks, options.credits),
      (task) => runDirect(task, options.defer),
      options.signal,
    );
    handled += tasks.length;
  }
  return handled;
}

type DirectOutcome = { finished: true } | { finished: false; reason: string };

async function runDirect(task: LeasedTask, defer: Defer): Promise<void> {
  const work: Promise<DirectOutcome> = forOrganization(
    task.organizationId,
    () => handleDirectBilled(task),
  ).then(
    () => ({ finished: true }) as const,
    (error: unknown) => ({ finished: false, reason: reasonOf(error) }) as const,
  );
  const outcome = await settledWithin(work, DISPATCH.sweep.itemTimeoutMs);
  if (outcome.settled) {
    await reconcileDirect(task, outcome.value);
    return;
  }
  defer(work.then((late) => reconcileDirect(task, late)));
}

async function reconcileDirect(
  task: LeasedTask,
  outcome: DirectOutcome,
): Promise<void> {
  if (outcome.finished) return;
  console.error("[agent] visible task failed", {
    taskId: task.id,
    kind: task.kind,
    reason: outcome.reason,
  });
  await settle(task, "FAILED", outcome.reason).catch(() => {});
}

/** A logo or photo lookup, its Context.dev calls billed once it ran. */
async function handleDirectBilled(task: LeasedTask): Promise<void> {
  const spent: ProviderSpend[] = [];
  try {
    await withSpendSink(
      (spend) => {
        spent.push(spend);
      },
      () => handleDirect(task),
    );
  } finally {
    await billResearchSpend(task.organizationId, spent, { taskId: task.id });
  }
}

async function handleDirect(task: LeasedTask): Promise<void> {
  const { organizationId } = task;
  if (task.kind === SLACK_SYNC_KIND) {
    const run = await SlackSyncService.runSync(
      organizationId,
      task.payload,
      (progress) =>
        AgentTaskRepository.replaceOpenPayload(
          organizationId,
          task.id,
          progress,
        ),
    );
    if (run.done) {
      await AgentTaskRepository.complete(organizationId, task.id, run.outcome);
    } else {
      await AgentTaskRepository.release(organizationId, task.id, run.resumeAt);
    }
    return;
  }
  if (task.kind === "brand" && task.companyId) {
    const result = await runBrand({
      organizationId,
      companyId: task.companyId,
    });
    const favicon = await storeFavicon({
      organizationId,
      companyId: task.companyId,
    });
    // A lookup worth retrying is retried when the lease runs out.
    if (result.retryable) return;
    await AgentTaskRepository.complete(
      organizationId,
      task.id,
      favicon
        ? `${brandOutcome(result)} Used the site's favicon as its icon.`
        : brandOutcome(result),
    );
    return;
  }
  if (task.kind === "portrait" && task.contactId) {
    const portrait = await runPortrait({
      organizationId,
      contactId: task.contactId,
      spend: FREE,
    });
    await AgentTaskRepository.complete(
      organizationId,
      task.id,
      portrait.stored
        ? `Picture stored from ${portrait.source}.`
        : (portrait.reason ?? "No picture found."),
    );
    return;
  }
  await AgentTaskRepository.complete(
    organizationId,
    task.id,
    "The record this names is gone.",
  );
}

/**
 * Leases due research tasks across organizations and starts a session for
 * each. `askedForOnly` (a first-party deployment holding its scheduled
 * research) leaves all but the work a person asked for.
 *
 * Research the model can't do waits rather than fails: with no way to a
 * model at all (`modelConfigured` false) nothing is leased, and an
 * organization whose model the gateway refused lately is left until
 * MODEL_RETRY_MS has passed, when its next session finds out whether a key
 * has been set meanwhile. Research nobody can pay for waits too (`credits`).
 */
export async function runResearchLane(options: {
  start: ResearchStart;
  modelConfigured: boolean;
  askedForOnly: boolean;
  signal?: AbortSignal;
  defer: Defer;
  credits?: CreditCheck;
}): Promise<number> {
  if (options.signal?.aborted || !options.modelConfigured) return 0;
  const tasks = await AgentQueueRepository.claimDue({
    limit: DISPATCH.research.batch,
    lane: { except: [...DIRECT_KINDS, AGENT_EVENT_KIND] },
    leaseMs: DISPATCH.research.leaseMs,
    minPriority: options.askedForOnly ? ASKED_FOR_PRIORITY : undefined,
    heldSince: new Date(Date.now() - MODEL_RETRY_MS).toISOString(),
    creditsHeldSince: options.credits ? creditsHeldSince() : undefined,
  });
  const funded = await withCredits(tasks, options.credits);
  await Promise.all(funded.map((task) => beginResearch(task, options)));
  return funded.length;
}

const COSTS_NOTHING = new Set<string>(FREE_KINDS);

/**
 * The leased tasks whose organizations have credits to pay for them, or that
 * cost nothing. The others go back to the queue, their attempts uncounted, to
 * wait for credits.
 */
async function withCredits(
  tasks: LeasedTask[],
  credits: CreditCheck | undefined,
): Promise<LeasedTask[]> {
  if (!credits) return tasks;
  const funded: LeasedTask[] = [];
  for (const task of tasks) {
    if (COSTS_NOTHING.has(task.kind) || (await credits(task.organizationId))) {
      funded.push(task);
    } else await AgentTaskRepository.release(task.organizationId, task.id);
  }
  return funded;
}

type StartOutcome =
  | { accepted: true; sessionId: string }
  | { accepted: false; reason: string };

async function beginResearch(
  task: LeasedTask,
  options: {
    start: ResearchStart;
    defer: Defer;
  },
): Promise<void> {
  try {
    await markRunning(task);
  } catch (error) {
    await settle(task, "FAILED", reasonOf(error)).catch(() => {});
    return;
  }
  const send: Promise<StartOutcome> = options.start(task).then(
    (session) => ({ accepted: true, sessionId: session.sessionId }) as const,
    (error: unknown) => ({ accepted: false, reason: reasonOf(error) }) as const,
  );
  const outcome = await settledWithin(send, DISPATCH.sweep.startTimeoutMs);
  if (outcome.settled) {
    await reconcileStart(task, outcome.value);
    return;
  }
  // A slow start is reconciled, never failed: the record stays researching,
  // and the session id is attached when the start lands.
  options.defer(send.then((late) => reconcileStart(task, late)));
}

async function reconcileStart(
  task: LeasedTask,
  outcome: StartOutcome,
): Promise<void> {
  if (outcome.accepted) {
    await linkSession(task, outcome.sessionId);
    return;
  }
  console.error("[agent] research session did not start", {
    taskId: task.id,
    reason: outcome.reason,
  });
  await settle(task, "FAILED", outcome.reason).catch(() => {});
}

async function linkSession(task: LeasedTask, sessionId: string): Promise<void> {
  const { attempts, retryMs } = DISPATCH.research.link;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await AgentTaskRepository.noteSession(
        task.organizationId,
        task.id,
        sessionId,
      );
      return;
    } catch (error) {
      if (attempt === attempts) {
        console.error(
          `[agent] Task ${task.id} accepted session ${sessionId}, but the session id was not recorded: ${reasonOf(error)}`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
    }
  }
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
