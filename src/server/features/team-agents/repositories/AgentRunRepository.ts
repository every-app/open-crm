import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { agentDefinition, agentRun, agentVersion, user } from "@/db/schema";
import {
  ACTIVE_RUN_STATUSES,
  type RunStatus,
  type TriggerType,
} from "@/shared/team-agents";

// Team agent runs and their action ledger. Runs are org-scoped like every
// table; the dispatcher's scans (queued, overrunning, undelivered) are the
// one place reads span organizations, and each returns the organization of
// every run it hands back.

type NewRun = {
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

async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select(runColumns())
    .from(agentRun)
    .where(
      and(eq(agentRun.organizationId, organizationId), eq(agentRun.id, id)),
    )
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
    })
    .from(agentRun)
    .innerJoin(agentDefinition, eq(agentDefinition.id, agentRun.agentId))
    .innerJoin(agentVersion, eq(agentVersion.id, agentRun.versionId))
    .where(
      and(eq(agentRun.organizationId, organizationId), eq(agentRun.id, id)),
    )
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
  stageResult,
  addUsage,
  listForAgent,
};
