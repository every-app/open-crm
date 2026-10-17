import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { agentTask } from "@/db/schema";

export type NewAgentTask = {
  organizationId: string;
  kind: string;
  reason: string;
  priority: number;
  budget: number;
  subject: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  payload?: unknown;
  dueAt?: string;
};

/** What a task is about: enough to settle the record's enrichment status. */
export type TaskSubject = {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  kind: string;
};

export const subjectColumns = {
  id: agentTask.id,
  organizationId: agentTask.organizationId,
  contactId: agentTask.contactId,
  companyId: agentTask.companyId,
  dealId: agentTask.dealId,
  kind: agentTask.kind,
};

/**
 * Inserts the task unless one of its kind is already open for its subject
 * (the partial unique index agent_task_open_kind_subject_uidx). True when it
 * was inserted. One statement on both backends, so two requests racing to
 * queue the same work can't both win, with no lock.
 */
async function insertIfAbsent(task: NewAgentTask): Promise<boolean> {
  const id = crypto.randomUUID();
  // A no-op upsert rather than DO NOTHING: Drizzle's SQLite builder puts a
  // DO NOTHING's index predicate after the action, where SQLite refuses it,
  // while DO UPDATE's `targetWhere` lands in the conflict target on both
  // backends. RETURNING then names the row that holds the slot: ours when
  // the insert happened, the open task's when it didn't.
  const [row] = await db
    .insert(agentTask)
    .values({
      id,
      organizationId: task.organizationId,
      kind: task.kind,
      reason: task.reason,
      priority: task.priority,
      budget: task.budget,
      subject: task.subject,
      contactId: task.contactId ?? null,
      companyId: task.companyId ?? null,
      dealId: task.dealId ?? null,
      payload: task.payload ?? null,
      dueAt: task.dueAt ?? new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [agentTask.organizationId, agentTask.kind, agentTask.subject],
      targetWhere: sql`${agentTask.finishedAt} is null`,
      set: { kind: task.kind },
    })
    .returning({ id: agentTask.id });
  return row?.id === id;
}

/** The open task of `kind` for `subject`, if any. */
async function findOpen(organizationId: string, kind: string, subject: string) {
  const [row] = await db
    .select()
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.kind, kind),
        eq(agentTask.subject, subject),
        isNull(agentTask.finishedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Subjects among `subjects` that already have an open task of `kind`. */
async function openSubjects(
  organizationId: string,
  kind: string,
  subjects: string[],
): Promise<Set<string>> {
  if (subjects.length === 0) return new Set();
  const rows = await db
    .select({ subject: agentTask.subject })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.kind, kind),
        inArray(agentTask.subject, subjects),
        isNull(agentTask.finishedAt),
      ),
    );
  return new Set(rows.flatMap((row) => (row.subject ? [row.subject] : [])));
}

/**
 * Replaces an open task's payload. False when the task has finished (or isn't
 * the organization's) meanwhile, so the caller queues a fresh one instead.
 */
async function replaceOpenPayload(
  organizationId: string,
  id: string,
  payload: unknown,
): Promise<boolean> {
  const updated = await db
    .update(agentTask)
    .set({ payload })
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.id, id),
        isNull(agentTask.finishedAt),
      ),
    )
    .returning({ id: agentTask.id });
  return updated.length > 0;
}

/**
 * Books `task` for its due time, or moves the open booking of its kind for
 * its subject to the new time and reason rather than queueing a second one
 * (the CRM's scheduleTask, behind schedule_recheck).
 */
/**
 * The open tasks of `kind` for `subjects`, chunked to stay under D1's bound
 * parameter limit.
 */
async function openBySubjects(
  organizationId: string,
  kind: string,
  subjects: string[],
) {
  const rows: { id: string; subject: string | null; payload: unknown }[] = [];
  for (let i = 0; i < subjects.length; i += SUBJECT_CHUNK) {
    rows.push(
      ...(await db
        .select({
          id: agentTask.id,
          subject: agentTask.subject,
          payload: agentTask.payload,
        })
        .from(agentTask)
        .where(
          and(
            eq(agentTask.organizationId, organizationId),
            eq(agentTask.kind, kind),
            inArray(agentTask.subject, subjects.slice(i, i + SUBJECT_CHUNK)),
            isNull(agentTask.finishedAt),
          ),
        )),
    );
  }
  return rows;
}

const SUBJECT_CHUNK = 90;

/**
 * Queues many tasks in batched writes (one round trip per batch on D1),
 * each the same no-op upsert as insertIfAbsent, so a task another request
 * queued meanwhile is left as it is instead of failing the batch.
 */
async function upsertMany(tasks: NewAgentTask[]): Promise<void> {
  await executeInBatches(tasks, (tx, task) =>
    tx
      .insert(agentTask)
      .values({
        id: crypto.randomUUID(),
        organizationId: task.organizationId,
        kind: task.kind,
        reason: task.reason,
        priority: task.priority,
        budget: task.budget,
        subject: task.subject,
        contactId: task.contactId ?? null,
        companyId: task.companyId ?? null,
        dealId: task.dealId ?? null,
        payload: task.payload ?? null,
        dueAt: task.dueAt ?? new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [agentTask.organizationId, agentTask.kind, agentTask.subject],
        targetWhere: sql`${agentTask.finishedAt} is null`,
        set: { kind: task.kind },
      }),
  );
}

/** Replaces open tasks' payloads in batched writes. */
async function replaceOpenPayloads(
  organizationId: string,
  updates: { id: string; payload: unknown }[],
): Promise<void> {
  await executeInBatches(updates, (tx, update) =>
    tx
      .update(agentTask)
      .set({ payload: update.payload })
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          eq(agentTask.id, update.id),
          isNull(agentTask.finishedAt),
        ),
      ),
  );
}

async function schedule(task: NewAgentTask & { dueAt: string }) {
  if (await insertIfAbsent(task)) {
    const created = await findOpen(
      task.organizationId,
      task.kind,
      task.subject,
    );
    return created ? { id: created.id } : null;
  }
  const [moved] = await db
    .update(agentTask)
    .set({ dueAt: task.dueAt, reason: task.reason })
    .where(
      and(
        eq(agentTask.organizationId, task.organizationId),
        eq(agentTask.kind, task.kind),
        eq(agentTask.subject, task.subject),
        isNull(agentTask.finishedAt),
      ),
    )
    .returning({ id: agentTask.id });
  return moved ?? null;
}

/**
 * Finishes the task with `outcome`, once. The task's subject when this call
 * finished it; null when it was already finished (or isn't the
 * organization's).
 */
async function complete(
  organizationId: string,
  taskId: string,
  outcome: string,
  sessionId?: string,
): Promise<TaskSubject | null> {
  const [row] = await db
    .update(agentTask)
    .set({
      finishedAt: new Date().toISOString(),
      outcome: outcome.slice(0, 500),
      ...(sessionId ? { sessionId } : {}),
    })
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.id, taskId),
        isNull(agentTask.finishedAt),
      ),
    )
    .returning(subjectColumns);
  return row ?? null;
}

/** Records which session is working the task. */
async function noteSession(
  organizationId: string,
  taskId: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(agentTask)
    .set({ sessionId })
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.id, taskId),
        isNull(agentTask.finishedAt),
      ),
    );
}

async function findById(organizationId: string, taskId: string) {
  const [row] = await db
    .select()
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask.id, taskId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** When the task finished, or null while it is open. */
async function finishedAt(
  organizationId: string,
  taskId: string,
): Promise<string | null> {
  return (await findById(organizationId, taskId))?.finishedAt ?? null;
}

/** Whether another task is still open for the contact or company. */
async function hasOtherOpen(
  organizationId: string,
  subject: { contactId: string | null; companyId: string | null },
  exceptTaskId: string,
): Promise<boolean> {
  const owners = [
    subject.contactId ? eq(agentTask.contactId, subject.contactId) : undefined,
    subject.companyId ? eq(agentTask.companyId, subject.companyId) : undefined,
  ].filter((owner) => owner !== undefined);
  if (owners.length === 0) return false;
  const [row] = await db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        isNull(agentTask.finishedAt),
        sql`${agentTask.id} <> ${exceptTaskId}`,
        or(...owners),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** A record's open tasks, most urgent first: what the agent is doing. */
async function openForRecord(
  organizationId: string,
  column: "contactId" | "companyId" | "dealId",
  recordId: string,
) {
  return db
    .select({
      id: agentTask.id,
      kind: agentTask.kind,
      reason: agentTask.reason,
      dueAt: agentTask.dueAt,
      leasedUntil: agentTask.leasedUntil,
      attempts: agentTask.attempts,
      startedAt: agentTask.startedAt,
    })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.organizationId, organizationId),
        eq(agentTask[column], recordId),
        isNull(agentTask.finishedAt),
      ),
    )
    .orderBy(desc(agentTask.priority), asc(agentTask.dueAt))
    .limit(20);
}

export const AgentTaskRepository = {
  openBySubjects,
  upsertMany,
  replaceOpenPayloads,
  insertIfAbsent,
  findOpen,
  openSubjects,
  replaceOpenPayload,
  schedule,
  complete,
  noteSession,
  findById,
  finishedAt,
  hasOtherOpen,
  openForRecord,
};
