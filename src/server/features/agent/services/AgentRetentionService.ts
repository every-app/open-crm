import { AgentRetentionRepository } from "../repositories/AgentRetentionRepository";

// The research agent's daily cleanup (src/server/cron.ts): finished tasks and
// agent events older than RETENTION_DAYS are deleted, a batch at a time,
// until none are left or the run's time is up (the next day carries on).
// Nothing reads them by then: the sweep looks back 30 days at most
// (dispatch/config.ts), and open tasks are never deleted. A run's history
// keeps its row and audit; its steps go with the events.

const DAY_MS = 24 * 60 * 60_000;
const RETENTION_DAYS = 30;
const BATCH = 500;
/** How long each table's deletes may run a day. */
const BUDGET_MS = 60_000;

async function inBatches(deleteBatch: () => Promise<number>): Promise<number> {
  const deadline = Date.now() + BUDGET_MS;
  let deleted = 0;
  while (Date.now() < deadline) {
    const batch = await deleteBatch();
    deleted += batch;
    if (batch < BATCH) break;
  }
  return deleted;
}

async function purge(at: Date): Promise<{ tasks: number; events: number }> {
  const before = new Date(at.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
  const tasks = await inBatches(() =>
    AgentRetentionRepository.deleteFinishedTasks(before, BATCH),
  );
  const events = await inBatches(() =>
    AgentRetentionRepository.deleteEvents(before, BATCH),
  );
  console.log("[agent] retention purge", { tasks, events });
  return { tasks, events };
}

export const AgentRetentionService = { purge };
