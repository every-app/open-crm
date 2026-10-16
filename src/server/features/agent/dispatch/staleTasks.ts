import { groupBy } from "remeda";
import {
  MAX_ATTEMPTS,
  ownsCompanyStatus,
  ownsContactStatus,
} from "@/shared/agent-tasks";
import { AgentRecordRepository } from "../repositories/AgentRecordRepository";
import { AgentQueueRepository } from "../repositories/AgentQueueRepository";
import { DISPATCH } from "./config";
import { settle } from "./enrichment";

// The stale-task sweep, ported from the CRM's lib/stale-tasks.ts. Before each
// tick's dispatch it closes rows that are provably done or provably dead, so
// the queue a person reads is the work that is actually happening. A database
// pass: no session, no model, no credits. It only looks at work that is due
// and holds no live lease; a live lease is work in flight.

const LANDED_OUTCOME =
  "The record was already up to date when this was checked again.";

const RETIRED_ERROR =
  "Research was attempted several times and never completed.";

const UNTARGETED_OUTCOME =
  "No record was ever attached to this task, so it can never be worked. Retired.";

type StaleTaskSweep = {
  scanned: number;
  closed: number;
  retired: number;
  released: number;
  waiting: number;
  unscanned: number;
  error: string | null;
};

type IdleTask = Awaited<
  ReturnType<typeof AgentQueueRepository.idleDue>
>["tasks"][number];

export async function reconcileStaleTasks(): Promise<StaleTaskSweep> {
  const sweep: StaleTaskSweep = {
    scanned: 0,
    closed: 0,
    retired: 0,
    released: 0,
    waiting: 0,
    unscanned: 0,
    error: null,
  };
  try {
    await runSweep(sweep);
  } catch (cause) {
    sweep.error = cause instanceof Error ? cause.message : String(cause);
    console.error(`[agent] Stale task reconciliation failed: ${sweep.error}`);
  }
  return sweep;
}

async function runSweep(sweep: StaleTaskSweep): Promise<void> {
  const { tasks, total } = await AgentQueueRepository.idleDue(
    DISPATCH.reconcile.scan,
  );
  sweep.scanned = tasks.length;
  sweep.unscanned = Math.max(0, total - tasks.length);
  const byOrganization = groupBy(tasks, (task) => task.organizationId);
  for (const [organizationId, group] of Object.entries(byOrganization)) {
    const completed = await AgentRecordRepository.completedAt(organizationId, {
      contactIds: unique(group.map((task) => task.contactId)),
      companyIds: unique(group.map((task) => task.companyId)),
    });
    const landed: string[] = [];
    const untargeted: string[] = [];
    const dead: string[] = [];
    for (const task of group) {
      if (isUntargetedFieldBackfill(task)) untargeted.push(task.id);
      else if (finishedElsewhere(task, completed)) landed.push(task.id);
      else if (task.attempts >= MAX_ATTEMPTS) continue;
      else if (task.leasedUntil !== null) dead.push(task.id);
      else sweep.waiting += 1;
    }
    sweep.closed += await AgentQueueRepository.closeIdle(
      organizationId,
      landed,
      LANDED_OUTCOME,
    );
    sweep.closed += await AgentQueueRepository.closeIdle(
      organizationId,
      untargeted,
      UNTARGETED_OUTCOME,
    );
    // A dead lease with attempts left goes back to waiting.
    sweep.released += await AgentQueueRepository.releaseExpired(
      organizationId,
      dead,
    );
  }
  sweep.retired = (await retireAbandoned()).length;
}

/** Retires tasks that spent their attempts, and fails their records. */
async function retireAbandoned() {
  let abandoned: Awaited<
    ReturnType<typeof AgentQueueRepository.retireExhausted>
  >;
  try {
    abandoned = await AgentQueueRepository.retireExhausted(
      DISPATCH.reconcile.retire,
    );
  } catch {
    return [];
  }
  for (const task of abandoned) {
    await settle(task, "FAILED", RETIRED_ERROR).catch(() => {});
  }
  return abandoned;
}

/** The task's record completed after the task started, without it closing. */
function finishedElsewhere(
  task: IdleTask,
  completed: Map<string, string>,
): boolean {
  if (task.attempts === 0 || task.startedAt === null) return false;
  const subjectId = task.contactId ?? task.companyId;
  if (!subjectId) return false;
  const owns = task.contactId
    ? ownsContactStatus(task.kind)
    : ownsCompanyStatus(task.kind);
  if (!owns) return false;
  const enrichedAt = completed.get(subjectId);
  return enrichedAt !== undefined && enrichedAt >= task.startedAt;
}

function isUntargetedFieldBackfill(task: IdleTask): boolean {
  return (
    task.kind === "field-backfill" &&
    !task.contactId &&
    !task.companyId &&
    !task.dealId
  );
}

function unique(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
