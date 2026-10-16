import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { chunk, sort } from "remeda";
import { db } from "@/db";
import { agentTask } from "@/db/schema";
import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "@/shared/agent-tasks";
import { subjectColumns, type TaskSubject } from "./AgentTaskRepository";

// The dispatcher's view of the queue. Leasing, retiring and the stale-task
// sweep work across every organization (the minute cron serves the whole
// queue), so these are the one place reads are not filtered to one
// organization: each returns the organization of every task it hands back,
// and everything done with a task after that is scoped to it.

// D1 binds at most 100 parameters per statement: id lists go in chunks.
const ID_CHUNK = 90;

export type LeasedTask = TaskSubject & {
  reason: string;
  payload: unknown;
  budget: number;
  attempts: number;
  priority: number;
  dueAt: string;
};

/** The dispatcher's two lanes: kinds it takes, or kinds it leaves. */
export type TaskLane =
  | { only: readonly string[] }
  | { except: readonly string[] };

const leasedColumns = {
  ...subjectColumns,
  reason: agentTask.reason,
  payload: agentTask.payload,
  budget: agentTask.budget,
  attempts: agentTask.attempts,
  priority: agentTask.priority,
  dueAt: agentTask.dueAt,
};

const unleased = (now: string) =>
  or(isNull(agentTask.leasedUntil), lt(agentTask.leasedUntil, now));

/**
 * Leases up to `limit` due tasks of `lane`, most urgent first. Across every
 * organization unless `organizationId` names one: the minute cron serves the
 * whole queue, a poke serves one organization's. Each returned task carries
 * its organization, and everything done with it after is scoped to that.
 *
 * A lease is a conditional update (no SKIP LOCKED on D1): the UPDATE re-checks
 * that each row is still unleased, so of two dispatchers that picked the same
 * candidates only one gets each row back. Every claim counts an attempt.
 */
async function claimDue(input: {
  limit: number;
  lane: TaskLane;
  leaseMs: number;
  organizationId?: string;
  minPriority?: number;
}): Promise<LeasedTask[]> {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + input.leaseMs).toISOString();
  const claimable = and(
    isNull(agentTask.finishedAt),
    lte(agentTask.dueAt, now),
    unleased(now),
    lt(agentTask.attempts, MAX_ATTEMPTS),
  );
  const candidates = await db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(
      and(
        claimable,
        "only" in input.lane
          ? inArray(agentTask.kind, [...input.lane.only])
          : notInArray(agentTask.kind, [...input.lane.except]),
        input.organizationId
          ? eq(agentTask.organizationId, input.organizationId)
          : undefined,
        input.minPriority === undefined
          ? undefined
          : gte(agentTask.priority, input.minPriority),
      ),
    )
    .orderBy(desc(agentTask.priority), asc(agentTask.dueAt))
    .limit(input.limit);
  if (candidates.length === 0) return [];
  const claimed = await db
    .update(agentTask)
    .set({
      leasedUntil: until,
      startedAt: sql`coalesce(${agentTask.startedAt}, ${now})`,
      attempts: sql`${agentTask.attempts} + 1`,
    })
    .where(
      and(
        inArray(
          agentTask.id,
          candidates.map((row) => row.id),
        ),
        claimable,
      ),
    )
    .returning(leasedColumns);
  // Postgres does not return an UPDATE's rows in any particular order.
  return sort(
    claimed,
    (a, b) => b.priority - a.priority || a.dueAt.localeCompare(b.dueAt),
  );
}

/**
 * Gives up on tasks that spent their attempts and hold no live lease: the
 * session never reported back. Across organizations, for the minute cron;
 * returns each retired task's subject so its record can be settled.
 */
async function retireExhausted(limit: number): Promise<TaskSubject[]> {
  const now = new Date().toISOString();
  const exhausted = and(
    isNull(agentTask.finishedAt),
    gte(agentTask.attempts, MAX_ATTEMPTS),
    unleased(now),
  );
  const ids = await db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(exhausted)
    .orderBy(asc(agentTask.dueAt))
    .limit(limit);
  const retired: TaskSubject[] = [];
  for (const part of chunk(
    ids.map((row) => row.id),
    ID_CHUNK,
  )) {
    retired.push(
      ...(await db
        .update(agentTask)
        .set({ finishedAt: now, outcome: RETIRED_OUTCOME })
        .where(and(inArray(agentTask.id, part), exhausted))
        .returning(subjectColumns)),
    );
  }
  return retired;
}

/**
 * Open, due tasks with no live lease, oldest first, across organizations: the
 * stale-task sweep's scan, and how many there are in all.
 */
async function idleDue(scan: number) {
  const now = new Date().toISOString();
  const idle = and(
    isNull(agentTask.finishedAt),
    lte(agentTask.dueAt, now),
    unleased(now),
  );
  const [tasks, [total]] = await Promise.all([
    db
      .select({
        ...subjectColumns,
        attempts: agentTask.attempts,
        leasedUntil: agentTask.leasedUntil,
        startedAt: agentTask.startedAt,
      })
      .from(agentTask)
      .where(idle)
      .orderBy(asc(agentTask.dueAt))
      .limit(scan),
    db.select({ value: count() }).from(agentTask).where(idle),
  ]);
  return { tasks, total: total?.value ?? 0 };
}

/** Finishes idle tasks (no live lease) with `outcome`. How many it closed. */
async function closeIdle(
  organizationId: string,
  ids: string[],
  outcome: string,
): Promise<number> {
  const now = new Date().toISOString();
  let closed = 0;
  for (const part of chunk(ids, ID_CHUNK)) {
    const rows = await db
      .update(agentTask)
      .set({ finishedAt: now, outcome })
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          inArray(agentTask.id, part),
          isNull(agentTask.finishedAt),
          unleased(now),
        ),
      )
      .returning({ id: agentTask.id });
    closed += rows.length;
  }
  return closed;
}

/** Clears expired leases, so the rows read as waiting rather than running. */
async function releaseExpired(
  organizationId: string,
  ids: string[],
): Promise<number> {
  const now = new Date().toISOString();
  let released = 0;
  for (const part of chunk(ids, ID_CHUNK)) {
    const rows = await db
      .update(agentTask)
      .set({ leasedUntil: null })
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          inArray(agentTask.id, part),
          isNull(agentTask.finishedAt),
          lt(agentTask.leasedUntil, now),
        ),
      )
      .returning({ id: agentTask.id });
    released += rows.length;
  }
  return released;
}

export const AgentQueueRepository = {
  claimDue,
  retireExhausted,
  idleDue,
  closeIdle,
  releaseExpired,
};
