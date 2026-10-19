import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily cleanup (a delete through a bounded subquery):
// finished tasks and agent events past 30 days go, and nothing open or recent.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { AgentRetentionService } from "./AgentRetentionService";

const DAY_MS = 24 * 60 * 60_000;
const ago = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

describe("the agent's daily cleanup", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  it("deletes finished tasks and agent events older than 30 days, and keeps what is open or recent", async () => {
    await database.exec(`
        INSERT INTO agent_task (id, organization_id, kind, reason, due_at, finished_at, subject) VALUES
          ('old_done', 'org_a', 'identify', 'x', '${ago(40)}', '${ago(31)}', 'contact:1'),
          ('recent_done', 'org_b', 'identify', 'x', '${ago(40)}', '${ago(29)}', 'contact:2'),
          ('old_open', 'org_a', 'recheck', 'x', '${ago(40)}', NULL, 'contact:3');
        INSERT INTO agent_event (id, organization_id, session_id, type, data, emitted_at) VALUES
          ('old_event', 'org_b', 'task.x', 'step.completed', '{}', '${ago(31)}'),
          ('recent_event', 'org_a', 'task.y', 'step.completed', '{}', '${ago(29)}');
      `);

    expect(await AgentRetentionService.purge(new Date())).toEqual({
      tasks: 1,
      events: 1,
    });
    expect(
      await database.rows("SELECT id FROM agent_task ORDER BY id"),
    ).toEqual([{ id: "old_open" }, { id: "recent_done" }]);
    expect(await database.rows("SELECT id FROM agent_event")).toEqual([
      { id: "recent_event" },
    ]);
  });
});
