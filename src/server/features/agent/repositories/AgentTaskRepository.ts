import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
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

export const AgentTaskRepository = {
  insertIfAbsent,
  findOpen,
  openSubjects,
  replaceOpenPayload,
};
