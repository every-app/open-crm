import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { agentRun, agentTask, dispatcherLane } from "@/db/schema";
import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "@/shared/agent-tasks";
import type { TaskLane } from "./AgentQueueRepository";

// What the dispatcher's health check reads (DispatchHealthService): when
// each lane of the minute cron last ran, which is the deployment's and holds
// no organization's data, and one organization's backlog in each lane.

export type LaneName = "visible" | "research" | "runs" | "sweep";

/** This tick's pass of each lane, and whether it threw. */
async function recordLanes(
  passes: { lane: LaneName; failed: boolean }[],
): Promise<void> {
  const now = new Date().toISOString();
  await runBatch((tx) =>
    passes.map((pass) =>
      tx
        .insert(dispatcherLane)
        .values({
          lane: pass.lane,
          ranAt: now,
          failedAt: pass.failed ? now : null,
        })
        .onConflictDoUpdate({
          target: dispatcherLane.lane,
          set: { ranAt: now, ...(pass.failed ? { failedAt: now } : {}) },
        }),
    ),
  );
}

async function lanes() {
  return db.select().from(dispatcherLane);
}

type BacklogWindow = {
  now: string;
  /** Due before this and not taken: overdue. */
  overdueBefore: string;
  /** Retired at or after this: a recent failure. */
  failedSince: string;
};

/**
 * One organization's open, due tasks in `lane`: how many, the oldest due
 * time, how many are overdue and not taken (only at or above `minPriority`
 * when it is set), and how many the dispatcher gave up on lately.
 */
async function taskBacklog(
  organizationId: string,
  lane: TaskLane,
  window: BacklogWindow & { minPriority: number | null },
) {
  const inLane =
    "only" in lane
      ? inArray(agentTask.kind, [...lane.only])
      : notInArray(agentTask.kind, [...lane.except]);
  const overdue = and(
    lte(agentTask.dueAt, window.overdueBefore),
    or(isNull(agentTask.leasedUntil), lt(agentTask.leasedUntil, window.now)),
    window.minPriority === null
      ? undefined
      : gte(agentTask.priority, window.minPriority),
  );
  const [open] = await db
    .select({
      backlog: count(),
      oldestDueAt: min(agentTask.dueAt),
      overdue: sql<number>`sum(case when ${overdue} then 1 else 0 end)`.mapWith(
        Number,
      ),
    })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        inLane,
        isNull(agentTask.finishedAt),
        lte(agentTask.dueAt, window.now),
        lt(agentTask.attempts, MAX_ATTEMPTS),
      ),
    );
  const [retired] = await db
    .select({ value: count() })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        inLane,
        gte(agentTask.finishedAt, window.failedSince),
        eq(agentTask.outcome, RETIRED_OUTCOME),
      ),
    );
  return {
    backlog: open?.backlog ?? 0,
    oldestDueAt: open?.oldestDueAt ?? null,
    overdue: open?.overdue ?? 0,
    failedLastDay: retired?.value ?? 0,
  };
}

/** One organization's queued team agent runs, and the runs that failed lately. */
async function runBacklog(organizationId: string, failedSince: string) {
  const [queued] = await db
    .select({ backlog: count(), oldestDueAt: min(agentRun.createdAt) })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.status, "QUEUED"),
      ),
    );
  const [failed] = await db
    .select({ value: count() })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.status, "FAILED"),
        gte(agentRun.finishedAt, failedSince),
      ),
    );
  return {
    backlog: queued?.backlog ?? 0,
    oldestDueAt: queued?.oldestDueAt ?? null,
    failedLastDay: failed?.value ?? 0,
  };
}

export const DispatchHealthRepository = {
  recordLanes,
  lanes,
  taskBacklog,
  runBacklog,
};
