import { z } from "zod";
import { literal, type Database } from "./db.ts";

// Puts a stuck research task back on the queue, due now: a task retired
// after its attempts, or one no session holds. It is closed and queued
// again as a fresh copy, because a task's session (task.<org>.<task id>)
// keeps its spent token and lookup budgets across attempts. The record's
// research status follows the copy when the dispatcher starts it.

const REQUEUED = "Requeued by an operator.";

const taskRow = z.object({
  id: z.string(),
  organization_id: z.string(),
  kind: z.string(),
  subject: z.string().nullable(),
  reason: z.string(),
  priority: z.number(),
  attempts: z.number(),
  due_at: z.string(),
  leased_until: z.string().nullable(),
  finished_at: z.string().nullable(),
  outcome: z.string().nullable(),
});

export async function requeueTask(
  db: Database,
  taskId: string,
  execute: boolean,
) {
  const now = new Date().toISOString();
  const [row] = await db.query(
    `select id, organization_id, kind, subject, reason, priority, attempts, due_at, leased_until, finished_at, outcome
     from agent_task where id = ${literal(taskId)}`,
  );
  if (!row) throw new Error(`No task ${taskId}.`);
  const task = taskRow.parse(row);
  if (
    task.finished_at === null &&
    task.leased_until !== null &&
    task.leased_until > now
  ) {
    return {
      task,
      requeued: false,
      why: `A session holds it until ${task.leased_until}.`,
    };
  }
  const [open] = await db.query(
    `select id from agent_task
     where organization_id = ${literal(task.organization_id)} and kind = ${literal(task.kind)}
       and ${task.subject === null ? "subject is null" : `subject = ${literal(task.subject)}`}
       and finished_at is null and id <> ${literal(task.id)}`,
  );
  if (open) {
    return {
      task,
      requeued: false,
      why: `Already queued as ${z.string().parse(open.id)}.`,
    };
  }
  if (!execute) {
    return {
      task,
      requeued: false,
      why: "Dry run. Run it again with --execute to close it and queue a copy due now.",
    };
  }

  // Closes it if it's still open and no session took it since it was read.
  await db.query(
    `update agent_task set finished_at = ${literal(now)}, outcome = ${literal(REQUEUED)}
     where id = ${literal(task.id)} and finished_at is null
       and (leased_until is null or leased_until <= ${literal(now)})`,
  );
  const copyId = crypto.randomUUID();
  await db.query(
    `insert into agent_task (id, organization_id, contact_id, company_id, deal_id, kind, reason, payload, priority, budget, attempts, due_at, subject, created_at)
     select ${literal(copyId)}, organization_id, contact_id, company_id, deal_id, kind, reason, payload, priority, budget, 0, ${literal(now)}, subject, ${literal(now)}
     from agent_task where id = ${literal(task.id)} and finished_at is not null`,
  );
  const [copy] = await db.query(
    `select id, kind, subject, priority, due_at from agent_task where id = ${literal(copyId)}`,
  );
  if (!copy) {
    throw new Error(
      `A session took ${task.id} while it was being read; nothing was queued.`,
    );
  }
  return { task, requeued: true, copy };
}
