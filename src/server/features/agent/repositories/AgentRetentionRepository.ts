import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { agentEvent, agentTask } from "@/db/schema";

// The daily cleanup's deletes (services/AgentRetentionService.ts): agent
// rows past their age, across organizations, a bounded batch at a time. The
// one place agent rows are deleted by age alone: none of them is read once
// it is that old.

/** Deletes up to `limit` tasks that finished before `before`. How many. */
async function deleteFinishedTasks(
  before: string,
  limit: number,
): Promise<number> {
  const old = db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(
      and(isNotNull(agentTask.finishedAt), lt(agentTask.finishedAt, before)),
    )
    .limit(limit);
  const deleted = await db
    .delete(agentTask)
    .where(inArray(agentTask.id, old))
    .returning({ id: agentTask.id });
  return deleted.length;
}

/** Deletes up to `limit` agent events emitted before `before`. How many. */
async function deleteEvents(before: string, limit: number): Promise<number> {
  const old = db
    .select({ id: agentEvent.id })
    .from(agentEvent)
    .where(lt(agentEvent.emittedAt, before))
    .limit(limit);
  const deleted = await db
    .delete(agentEvent)
    .where(inArray(agentEvent.id, old))
    .returning({ id: agentEvent.id });
  return deleted.length;
}

export const AgentRetentionRepository = { deleteFinishedTasks, deleteEvents };
