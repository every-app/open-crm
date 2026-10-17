import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { agentAction, agentRun } from "@/db/schema";

// The action ledger (agent_action): every side effect a run attempts is a row
// before it happens, keyed by the run and the model's tool call, so a
// replayed call finds the action it already took instead of taking it twice.

const ID_CHUNK = 90;

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

export const AgentActionRepository = {
  findAction,
  planAction,
  claimAction,
  holdsAction,
  finishAction,
  noteDeliveredOutsideClaim,
  actionsForRuns,
};
