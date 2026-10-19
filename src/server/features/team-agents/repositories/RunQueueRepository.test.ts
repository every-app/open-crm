import { beforeEach, describe, expect, it, vi } from "vitest";

// The runs the minute cron starts next, on both backends: each agent's
// oldest, organizations taking turns, none past its share of the tick.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { RunQueueRepository } from "./RunQueueRepository";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the queued runs (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO agent_definition (id, organization_id, name, status, created_by_id) VALUES
          ('a1', 'org_a', 'One', 'LIVE', 'user_a'), ('a2', 'org_a', 'Two', 'LIVE', 'user_a'),
          ('a3', 'org_a', 'Three', 'LIVE', 'user_a'), ('b1', 'org_b', 'Bee', 'LIVE', 'user_b');
        INSERT INTO agent_version (id, organization_id, agent_id, number, status, instructions, manifest, created_by_id) VALUES
          ('v_a1', 'org_a', 'a1', 1, 'DEPLOYED', 'Run', '{}', 'user_a'), ('v_a2', 'org_a', 'a2', 1, 'DEPLOYED', 'Run', '{}', 'user_a'),
          ('v_a3', 'org_a', 'a3', 1, 'DEPLOYED', 'Run', '{}', 'user_a'), ('v_b1', 'org_b', 'b1', 1, 'DEPLOYED', 'Run', '{}', 'user_b');
        INSERT INTO agent_run (id, organization_id, agent_id, version_id, trigger_type, idempotency_key, created_at) VALUES
          ('a1_first', 'org_a', 'a1', 'v_a1', 'SCHEDULE', 'a1_first', '2026-10-01T09:00:00.000Z'),
          ('a1_next', 'org_a', 'a1', 'v_a1', 'SCHEDULE', 'a1_next', '2026-10-01T09:01:00.000Z'),
          ('a2_first', 'org_a', 'a2', 'v_a2', 'SCHEDULE', 'a2_first', '2026-10-01T09:02:00.000Z'),
          ('a3_first', 'org_a', 'a3', 'v_a3', 'SCHEDULE', 'a3_first', '2026-10-01T09:03:00.000Z'),
          ('b1_first', 'org_b', 'b1', 'v_b1', 'MANUAL', 'b1_first', '2026-10-01T10:00:00.000Z');
      `);
    });

    it("starts each agent's oldest run, organizations taking turns, none past its share", async () => {
      const next = await RunQueueRepository.queuedAcrossOrganizations({
        limit: 10,
        perOrganization: 2,
      });
      expect(next.map((run) => run.id)).toEqual([
        "a1_first",
        "b1_first",
        "a2_first",
      ]);
    });
  });
}
