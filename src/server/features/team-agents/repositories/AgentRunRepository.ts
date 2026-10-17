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
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { chunk } from "remeda";
import { db } from "@/db";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { runBatch } from "@/db/runBatch";
import {
  agentAction,
  agentAuditEvent,
  agentDefinition,
  agentEvent,
  agentRun,
  agentVersion,
  user,
} from "@/db/schema";
import {
  ACTIVE_RUN_STATUSES,
  type RunStatus,
  type TriggerType,
} from "@/shared/team-agents";
import type { NewAudit } from "./TeamAgentRepository";

// Team agent runs and their action ledger. Runs are org-scoped like every
// table; the dispatcher's scans (queued, overrunning, undelivered) are the
// one place reads span organizations, and each returns the organization of
// every run it hands back.

const ID_CHUNK = 90;

export type NewRun = {
  organizationId: string;
  agentId: string;
  versionId: string;
  triggerId: string | null;
  initiatedById: string | null;
  triggerType: TriggerType;
  idempotencyKey: string;
  input: unknown;
};

/**
 * Queues a run unless one with its idempotency key exists (a replayed
 * request, a schedule slot or an event already delivered). The run's id and
 * whether this call created it.
 */
async function insertIfAbsent(
  run: NewRun,
): Promise<{ id: string; created: boolean }> {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(agentRun)
    .values({ ...run, id, input: run.input ?? null })
    .onConflictDoUpdate({
      target: [agentRun.organizationId, agentRun.idempotencyKey],
      set: { idempotencyKey: run.idempotencyKey },
    })
    .returning({ id: agentRun.id, agentId: agentRun.agentId });
  if (!row) throw new Error("Run row missing after insert");
  if (row.agentId !== run.agentId) {
    throw new Error("That run request was already used for another agent.");
  }
  return { id: row.id, created: row.id === id };
}

/** The run a request, a schedule slot or an event already made, if any. */
async function findByKey(organizationId: string, idempotencyKey: string) {
  const [row] = await db
    .select({ id: agentRun.id, agentId: agentRun.agentId })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

const runColumns = () => ({
  id: agentRun.id,
  organizationId: agentRun.organizationId,
  agentId: agentRun.agentId,
  versionId: agentRun.versionId,
  triggerId: agentRun.triggerId,
  initiatedById: agentRun.initiatedById,
  triggerType: agentRun.triggerType,
  status: agentRun.status,
  sessionId: agentRun.sessionId,
  input: agentRun.input,
  result: agentRun.result,
  summary: agentRun.summary,
  noActionNeeded: agentRun.noActionNeeded,
  modelId: agentRun.modelId,
  inputTokens: agentRun.inputTokens,
  outputTokens: agentRun.outputTokens,
  costUsd: agentRun.costUsd,
  errorCode: agentRun.errorCode,
  errorMessage: agentRun.errorMessage,
  createdAt: agentRun.createdAt,
  startedAt: agentRun.startedAt,
  finishedAt: agentRun.finishedAt,
});

export type RunRow = NonNullable<Awaited<ReturnType<typeof findById>>>;

async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select(runColumns())
    .from(agentRun)
    .where(and(eq(agentRun.organizationId, organizationId), eq(agentRun.id, id)))
    .limit(1);
  return row ?? null;
}

/** A run with the version it pins, for the runner. */
async function findWithVersion(organizationId: string, id: string) {
  const [row] = await db
    .select({
      ...runColumns(),
      agentName: agentDefinition.name,
      agentDescription: agentDefinition.description,
      agentCreatedById: agentDefinition.createdById,
      versionNumber: agentVersion.number,
      instructions: agentVersion.instructions,
      manifest: agentVersion.manifest,
      versionModelId: agentVersion.modelId,
    })
    .from(agentRun)
    .innerJoin(agentDefinition, eq(agentDefinition.id, agentRun.agentId))
    .innerJoin(agentVersion, eq(agentVersion.id, agentRun.versionId))
    .where(and(eq(agentRun.organizationId, organizationId), eq(agentRun.id, id)))
    .limit(1);
  return row ?? null;
}

/** Whether the agent has a run queued or running. */
async function hasActiveRun(
  organizationId: string,
  agentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.agentId, agentId),
        inArray(agentRun.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** How many runs the agent was given since `since`. */
async function countSince(
  organizationId: string,
  agentId: string,
  since: string,
): Promise<number> {
  const [row] = await db
    .select({ runs: count() })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.agentId, agentId),
        gte(agentRun.createdAt, since),
      ),
    );
  return row?.runs ?? 0;
}

/**
 * Takes a queued run: QUEUED → RUNNING. False when it is no longer queued, or
 * when another run of its agent is running (the partial unique index), so it
 * stays queued for later.
 */
async function claim(
  organizationId: string,
  id: string,
  modelId: string,
): Promise<boolean> {
  try {
    const rows = await db
      .update(agentRun)
      .set({ status: "RUNNING", startedAt: new Date().toISOString(), modelId })
      .where(
        and(
          eq(agentRun.organizationId, organizationId),
          eq(agentRun.id, id),
          eq(agentRun.status, "QUEUED"),
        ),
      )
      .returning({ id: agentRun.id });
    return rows.length > 0;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function setSession(
  organizationId: string,
  id: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(agentRun)
    .set({ sessionId })
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.id, id),
        eq(agentRun.status, "RUNNING"),
      ),
    );
}

/** A delivery that never landed goes back to the queue. */
async function requeue(organizationId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(agentRun)
    .set({ status: "QUEUED", startedAt: null })
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.id, id),
        eq(agentRun.status, "RUNNING"),
        isNull(agentRun.sessionId),
      ),
    )
    .returning({ id: agentRun.id });
  return rows.length > 0;
}

/**
 * Ends the run as `status` if it is still in one of `from`: the one write
 * that decides how a run ended. The run as it now is, or null when it had
 * already ended (or isn't the organization's).
 */
async function settle(
  organizationId: string,
  id: string,
  input: {
    from: readonly RunStatus[];
    status: "SUCCEEDED" | "FAILED" | "CANCELLED";
    errorCode?: string | null;
    errorMessage?: string | null;
    summary?: string | null;
  },
) {
  const finishedAt = new Date().toISOString();
  const [row] = await db
    .update(agentRun)
    .set({
      status: input.status,
      finishedAt,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
    })
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.id, id),
        inArray(agentRun.status, [...input.from]),
      ),
    )
    .returning(runColumns());
  return row ?? null;
}

/**
 * What the winner of a settle writes after it: the run's terminal event, its
 * outstanding actions cancelled (when it was stopped) and the audit line, in
 * one batch. Each is idempotent, so writing them twice changes nothing.
 */
async function recordEnding(input: {
  organizationId: string;
  runId: string;
  sessionId: string;
  type: "run.completed" | "run.failed" | "run.cancelled";
  data: Record<string, unknown>;
  cancelActions: { code: string; message: string } | null;
  audit: NewAudit;
}): Promise<void> {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    ...(input.cancelActions
      ? [
          tx
            .update(agentAction)
            .set({
              status: "CANCELLED",
              errorCode: input.cancelActions.code,
              errorMessage: input.cancelActions.message,
              completedAt: now,
            })
            .where(
              and(
                eq(agentAction.organizationId, input.organizationId),
                eq(agentAction.runId, input.runId),
                inArray(agentAction.status, ["PLANNED", "RUNNING"]),
              ),
            ),
        ]
      : []),
    tx
      .insert(agentEvent)
      .values({
        id: `${input.type}:${input.runId}`,
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        contactId: null,
        companyId: null,
        dealId: null,
        conversationId: null,
        type: input.type,
        data: input.data,
        emittedAt: now,
      })
      .onConflictDoNothing({ target: agentEvent.id }),
    tx
      .insert(agentAuditEvent)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        agentId: input.audit.agentId,
        versionId: input.audit.versionId ?? null,
        actorUserId: input.audit.actorUserId ?? null,
        actorType: input.audit.actorType,
        type: input.audit.type,
        summary: input.audit.summary,
        requestId: input.audit.requestId ?? null,
        emittedAt: now,
      })
      .onConflictDoNothing({
        target: [
          agentAuditEvent.agentId,
          agentAuditEvent.type,
          agentAuditEvent.requestId,
        ],
      }),
  ]);
}

/** The run's staged result (finish_run), while it is running. */
async function stageResult(
  organizationId: string,
  id: string,
  input: { summary: string; result: unknown; noActionNeeded: string | null },
): Promise<boolean> {
  const rows = await db
    .update(agentRun)
    .set(input)
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.id, id),
        eq(agentRun.status, "RUNNING"),
      ),
    )
    .returning({ id: agentRun.id });
  return rows.length > 0;
}

/** Adds a model step's tokens and cost to the run. */
async function addUsage(
  organizationId: string,
  id: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
): Promise<void> {
  await db
    .update(agentRun)
    .set({
      inputTokens: sql`${agentRun.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${agentRun.outputTokens} + ${usage.outputTokens}`,
      costUsd: sql`round(${agentRun.costUsd} + ${usage.costUsd}, 6)`,
    })
    .where(
      and(eq(agentRun.organizationId, organizationId), eq(agentRun.id, id)),
    );
}

/** The agent's runs, newest first, with who started each. */
async function listForAgent(
  organizationId: string,
  agentId: string,
  limit: number,
) {
  return db
    .select({
      ...runColumns(),
      initiatedByName: user.name,
      versionNumber: agentVersion.number,
    })
    .from(agentRun)
    .leftJoin(user, eq(user.id, agentRun.initiatedById))
    .innerJoin(agentVersion, eq(agentVersion.id, agentRun.versionId))
    .where(
      and(
        eq(agentRun.organizationId, organizationId),
        eq(agentRun.agentId, agentId),
      ),
    )
    .orderBy(desc(agentRun.createdAt), desc(agentRun.id))
    .limit(limit);
}

/** The steps of these runs' sessions, in order, at most `limit` each. */
async function eventsForSessions(
  organizationId: string,
  sessionIds: string[],
) {
  const rows = [];
  for (const ids of chunk(sessionIds, ID_CHUNK)) {
    rows.push(
      ...(await db
        .select({
          id: agentEvent.id,
          sessionId: agentEvent.sessionId,
          type: agentEvent.type,
          data: agentEvent.data,
          emittedAt: agentEvent.emittedAt,
        })
        .from(agentEvent)
        .where(
          and(
            eq(agentEvent.organizationId, organizationId),
            inArray(agentEvent.sessionId, ids),
          ),
        )
        .orderBy(asc(agentEvent.emittedAt), asc(agentEvent.id))),
    );
  }
  return rows;
}

/** A run event outside the session's own steps (queued, started). */
async function insertEvent(input: {
  organizationId: string;
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await db.insert(agentEvent).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    contactId: null,
    companyId: null,
    dealId: null,
    conversationId: null,
    type: input.type,
    data: input.data,
    emittedAt: new Date().toISOString(),
  });
}

// The dispatcher's scans, across organizations.


/**
 * Queued runs of live agents with nothing running, oldest first: the next
 * runs to start, at most one per agent.
 */
async function queuedAcrossOrganizations(
  limit: number,
  organizationId?: string,
) {
  const otherRun = alias(agentRun, "other_run");
  const rows = await db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      versionId: agentRun.versionId,
    })
    .from(agentRun)
    .innerJoin(
      agentDefinition,
      and(
        eq(agentDefinition.id, agentRun.agentId),
        eq(agentDefinition.status, "LIVE"),
      ),
    )
    .where(
      and(
        eq(agentRun.status, "QUEUED"),
        organizationId ? eq(agentRun.organizationId, organizationId) : undefined,
        notExists(
          db
            .select({ id: otherRun.id })
            .from(otherRun)
            .where(
              and(
                eq(otherRun.agentId, agentRun.agentId),
                eq(otherRun.status, "RUNNING"),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(agentRun.createdAt), asc(agentRun.id))
    .limit(limit * 4);
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.agentId)) return false;
      seen.add(row.agentId);
      return true;
    })
    .slice(0, limit);
}

/**
 * Running runs that started before `before`: delivered ones that never
 * finished (`delivered`), or ones whose delivery never landed.
 */
async function runningSince(
  before: string,
  delivered: boolean,
  limit: number,
) {
  return db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      sessionId: agentRun.sessionId,
    })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.status, "RUNNING"),
        lt(agentRun.startedAt, before),
        delivered
          ? sql`${agentRun.sessionId} is not null`
          : isNull(agentRun.sessionId),
      ),
    )
    .orderBy(asc(agentRun.startedAt))
    .limit(limit);
}

/** Queued runs of an agent that is no longer live, to cancel. */
async function queuedOfStoppedAgents(limit: number) {
  return db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      versionId: agentRun.versionId,
      agentStatus: agentDefinition.status,
    })
    .from(agentRun)
    .innerJoin(agentDefinition, eq(agentDefinition.id, agentRun.agentId))
    .where(
      and(
        eq(agentRun.status, "QUEUED"),
        or(
          eq(agentDefinition.status, "DELETED"),
          eq(agentDefinition.status, "ARCHIVED"),
        ),
      ),
    )
    .limit(limit);
}

// The action ledger.

const actionColumns = () => ({
  id: agentAction.id,
  runId: agentAction.runId,
  type: agentAction.type,
  provider: agentAction.provider,
  targetType: agentAction.targetType,
  targetId: agentAction.targetId,
  targetLabel: agentAction.targetLabel,
  summary: agentAction.summary,
  metadata: agentAction.metadata,
  status: agentAction.status,
  requestHash: agentAction.requestHash,
  externalId: agentAction.externalId,
  attemptCount: agentAction.attemptCount,
  errorCode: agentAction.errorCode,
  errorMessage: agentAction.errorMessage,
  plannedAt: agentAction.plannedAt,
  startedAt: agentAction.startedAt,
  completedAt: agentAction.completedAt,
});

export type ActionRow = NonNullable<Awaited<ReturnType<typeof findAction>>>;

async function findAction(organizationId: string, idempotencyKey: string) {
  const [row] = await db
    .select(actionColumns())
    .from(agentAction)
    .where(
      and(
        eq(agentAction.organizationId, organizationId),
        eq(agentAction.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Plans an action unless its key is taken; the action that holds the key. */
async function planAction(input: {
  organizationId: string;
  agentId: string;
  runId: string;
  type: string;
  provider: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string;
  metadata: unknown;
  idempotencyKey: string;
  requestHash: string;
  status?: "PLANNED" | "FAILED";
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<ActionRow> {
  await db
    .insert(agentAction)
    .values({
      id: crypto.randomUUID(),
      ...input,
      status: input.status ?? "PLANNED",
      completedAt: input.status === "FAILED" ? new Date().toISOString() : null,
    })
    .onConflictDoNothing({
      target: [agentAction.organizationId, agentAction.idempotencyKey],
    });
  const row = await findAction(input.organizationId, input.idempotencyKey);
  if (!row) throw new Error("Action row missing after insert");
  return row;
}

/**
 * Takes the action to perform it: a planned or failed one, or one whose last
 * holder's lease ran out. The claim's start time, or null when someone else
 * holds it.
 */
async function claimAction(
  organizationId: string,
  id: string,
  leaseMs: number,
): Promise<string | null> {
  const claimedAt = new Date().toISOString();
  const expired = new Date(Date.now() - leaseMs).toISOString();
  const rows = await db
    .update(agentAction)
    .set({
      status: "RUNNING",
      startedAt: claimedAt,
      completedAt: null,
      attemptCount: sql`${agentAction.attemptCount} + 1`,
      errorCode: null,
      errorMessage: null,
    })
    .where(
      and(
        eq(agentAction.organizationId, organizationId),
        eq(agentAction.id, id),
        or(
          inArray(agentAction.status, ["PLANNED", "FAILED"]),
          and(
            eq(agentAction.status, "RUNNING"),
            lt(agentAction.startedAt, expired),
          ),
        ),
      ),
    )
    .returning({ id: agentAction.id });
  return rows.length > 0 ? claimedAt : null;
}

/** Whether this claim still holds the action and its run still runs. */
async function holdsAction(
  organizationId: string,
  id: string,
  claimedAt: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: agentAction.id })
    .from(agentAction)
    .innerJoin(agentRun, eq(agentRun.id, agentAction.runId))
    .where(
      and(
        eq(agentAction.organizationId, organizationId),
        eq(agentAction.id, id),
        eq(agentAction.status, "RUNNING"),
        eq(agentAction.startedAt, claimedAt),
        eq(agentRun.status, "RUNNING"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Ends the claim as succeeded or failed; false when it was lost. */
async function finishAction(
  organizationId: string,
  id: string,
  claimedAt: string,
  outcome:
    | { status: "SUCCEEDED"; externalId: string }
    | { status: "FAILED"; errorCode: string; errorMessage: string },
): Promise<boolean> {
  const rows = await db
    .update(agentAction)
    .set({ ...outcome, completedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentAction.organizationId, organizationId),
        eq(agentAction.id, id),
        eq(agentAction.status, "RUNNING"),
        eq(agentAction.startedAt, claimedAt),
      ),
    )
    .returning({ id: agentAction.id });
  return rows.length > 0;
}

/**
 * Slack took a message after the run stopped holding the action: the message
 * exists, so the row says so even though the action is not SUCCEEDED.
 */
async function noteDeliveredOutsideClaim(
  organizationId: string,
  id: string,
  externalId: string,
  note: string,
): Promise<void> {
  await db
    .update(agentAction)
    .set({ externalId, errorMessage: note })
    .where(
      and(
        eq(agentAction.organizationId, organizationId),
        eq(agentAction.id, id),
        isNull(agentAction.externalId),
      ),
    );
}

async function actionsForRuns(organizationId: string, runIds: string[]) {
  const rows = [];
  for (const ids of chunk(runIds, ID_CHUNK)) {
    rows.push(
      ...(await db
        .select(actionColumns())
        .from(agentAction)
        .where(
          and(
            eq(agentAction.organizationId, organizationId),
            inArray(agentAction.runId, ids),
          ),
        )
        .orderBy(asc(agentAction.plannedAt), asc(agentAction.id))),
    );
  }
  return rows;
}

export const AgentRunRepository = {
  insertIfAbsent,
  findByKey,
  findById,
  findWithVersion,
  hasActiveRun,
  countSince,
  claim,
  setSession,
  requeue,
  settle,
  recordEnding,
  stageResult,
  addUsage,
  listForAgent,
  eventsForSessions,
  insertEvent,
  queuedAcrossOrganizations,
  runningSince,
  queuedOfStoppedAgents,
  findAction,
  planAction,
  claimAction,
  holdsAction,
  finishAction,
  noteDeliveredOutsideClaim,
  actionsForRuns,
};
