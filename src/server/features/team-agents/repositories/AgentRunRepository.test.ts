import { beforeEach, describe, expect, it, vi } from "vitest";

// An agent's run history, paged back by cursor on both backends: newest
// first, the id breaking a tie, and never another organization's runs.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { AgentRunRepository } from "./AgentRunRepository";

const AT = "2026-10-01T10:00:00.000Z";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`an agent's runs (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO agent_definition (id, organization_id, name, status, created_by_id) VALUES ('agent', 'org_a', 'Watcher', 'LIVE', 'user_a');
        INSERT INTO agent_version (id, organization_id, agent_id, number, status, instructions, manifest, created_by_id) VALUES ('v1', 'org_a', 'agent', 1, 'DEPLOYED', 'Watch', '{}', 'user_a');
        INSERT INTO agent_run (id, organization_id, agent_id, version_id, trigger_type, idempotency_key, created_at) VALUES
          ('run_a', 'org_a', 'agent', 'v1', 'MANUAL', 'a', '${AT}'),
          ('run_b', 'org_a', 'agent', 'v1', 'MANUAL', 'b', '${AT}'),
          ('run_c', 'org_a', 'agent', 'v1', 'MANUAL', 'c', '2026-10-01T09:00:00.000Z');
      `);
    });

    it("pages back from a cursor, the id breaking a tie, within the organization", async () => {
      const ids = async (organizationId: string, cursor?: string) =>
        (
          await AgentRunRepository.listForAgent(organizationId, "agent", 2, {
            cursor,
          })
        ).map((run) => run.id);

      expect(await ids("org_a")).toEqual(["run_b", "run_a"]);
      expect(await ids("org_a", `${AT}|run_b`)).toEqual(["run_a", "run_c"]);
      expect(await ids("org_a", `${AT}|run_a`)).toEqual(["run_c"]);
      expect(await ids("org_b")).toEqual([]);
    });
  });
}
