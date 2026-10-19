import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  not,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { chunk, sort } from "remeda";
import { db } from "@/db";
import { agentTask, workspace } from "@/db/schema";
import {
  ASKED_FOR_PRIORITY,
  FREE_KINDS,
  MAX_ATTEMPTS,
  RETIRED_OUTCOME,
} from "@/shared/agent-tasks";
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
  leasedUntil: string | null;
};

/** The dispatcher's two lanes: kinds it takes, or kinds it leaves. */
export type TaskLane =
  | { only: readonly string[] }
  | { except: readonly string[] };

// Read at call time, so a JSON column maps by the dialect in use.
const leasedColumns = () => ({
  ...subjectColumns,
  reason: agentTask.reason,
  payload: agentTask.payload,
  budget: agentTask.budget,
  attempts: agentTask.attempts,
  priority: agentTask.priority,
  dueAt: agentTask.dueAt,
  leasedUntil: agentTask.leasedUntil,
});

const unleased = (now: string) =>
  or(isNull(agentTask.leasedUntil), lt(agentTask.leasedUntil, now));

/**
 * The task's organization had its model refused by the gateway at or after
 * `since`, and the model hasn't answered since (AgentAvailabilityService).
 */
const modelRefusedSince = (since: string) =>
  sql`exists (select 1 from ${workspace} where ${workspace.organizationId} = ${agentTask.organizationId} and ${workspace.modelRefusedAt} >= ${since} and (${workspace.modelAnsweredAt} is null or ${workspace.modelAnsweredAt} < ${workspace.modelRefusedAt}))`;

/**
 * The task's organization was confirmed out of usage credits at or after
 * `since` (hosted billing, billing/creditReading.ts).
 */
const outOfCreditsSince = (since: string) =>
  sql`exists (select 1 from ${workspace} where ${workspace.organizationId} = ${agentTask.organizationId} and ${workspace.creditsDepletedAt} >= ${since})`;

/**
 * The task's organization turned off Research automatically (Settings →
 * General), so only work a person asked for runs.
 */
const researchHeldByOrganization = () =>
  exists(
    db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(
        and(
          eq(workspace.organizationId, agentTask.organizationId),
          eq(workspace.researchAutomatically, false),
        ),
      ),
  );

/**
 * Leases up to `limit` due tasks of `lane`. Across every organization unless
 * `organizationId` names one: the minute cron serves the whole queue, a poke
 * serves one organization's. Organizations take turns, round-robin: each
 * one's most urgent task, then each one's next, at most `perOrganization`
 * each, and none of `skipOrganizations`'. Each returned task carries its
 * organization, and everything done with it after is scoped to that.
 *
 * A lease is a conditional update (no SKIP LOCKED on D1): the UPDATE re-checks
 * that each row is still unleased, so of two dispatchers that picked the same
 * candidates only one gets each row back. Every claim counts an attempt.
 *
 * Work below what a person asked for waits where scheduled research is held:
 * everyone's with `minPriority` (a first-party deployment's switch), and an
 * organization's own once it turned off Research automatically. `heldSince`
 * leaves the tasks of organizations whose model the gateway refused since
 * then: they wait until the model is set up. `creditsHeldSince` leaves those
 * of organizations out of credits since then, but for work that costs
 * nothing (FREE_KINDS).
 */
async function claimDue(input: {
  limit: number;
  lane: TaskLane;
  leaseMs: number;
  organizationId?: string;
  perOrganization?: number;
  skipOrganizations?: readonly string[];
  minPriority?: number;
  heldSince?: string;
  creditsHeldSince?: string;
}): Promise<LeasedTask[]> {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + input.leaseMs).toISOString();
  const claimable = and(
    isNull(agentTask.finishedAt),
    lte(agentTask.dueAt, now),
    unleased(now),
    lt(agentTask.attempts, MAX_ATTEMPTS),
  );
  const ranked = db
    .select({
      id: agentTask.id,
      priority: agentTask.priority,
      dueAt: agentTask.dueAt,
      turn: sql<number>`row_number() over (partition by ${agentTask.organizationId} order by ${agentTask.priority} desc, ${agentTask.dueAt} asc)`.as(
        "turn",
      ),
    })
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
        input.skipOrganizations?.length
          ? notInArray(agentTask.organizationId, [...input.skipOrganizations])
          : undefined,
        input.minPriority === undefined
          ? undefined
          : gte(agentTask.priority, input.minPriority),
        or(
          gte(agentTask.priority, ASKED_FOR_PRIORITY),
          not(researchHeldByOrganization()),
        ),
        input.heldSince === undefined
          ? undefined
          : sql`not ${modelRefusedSince(input.heldSince)}`,
        input.creditsHeldSince === undefined
          ? undefined
          : or(
              inArray(agentTask.kind, [...FREE_KINDS]),
              sql`not ${outOfCreditsSince(input.creditsHeldSince)}`,
            ),
      ),
    )
    .as("ranked");
  const candidates = await db
    .select({ id: ranked.id })
    .from(ranked)
    .where(
      input.perOrganization === undefined
        ? undefined
        : lte(ranked.turn, input.perOrganization),
    )
    .orderBy(asc(ranked.turn), desc(ranked.priority), asc(ranked.dueAt))
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
    .returning(leasedColumns());
  // In the candidates' order: Postgres does not return an UPDATE's rows in
  // any particular one.
  const order = new Map(candidates.map((row, index) => [row.id, index]));
  return sort(
    claimed,
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
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
