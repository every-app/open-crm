import { beforeEach, describe, expect, it, vi } from "vitest";

// A person's builder chats as Chat's column lists them, and the records the
// composer offers to tag, on both backends. A chat is working only while its
// own agent says a turn is answering, whatever its timestamps suggest; the
// tag picker starts from the most recently active records, and never shows
// another organization's.
const { testDb, answering, asked } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return {
    testDb: await createDualDialectTestDb(),
    answering: new Set<string>(),
    asked: vi.fn<(sessionId: string) => void>(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.modules.workers.env,
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// Each chat's CrmAgent, which the list asks whether a turn is answering.
vi.mock("agents", () => ({
  getAgentByName: async (_namespace: unknown, sessionId: string) => ({
    isAnswering: async () => {
      asked(sessionId);
      return answering.has(sessionId);
    },
  }),
}));

import { BuilderService } from "./BuilderService";

const owner = { organizationId: "org_a", userId: "user_a", role: "owner" };

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`builder chats (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      answering.clear();
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("shows a chat working only while its agent is answering a turn", async () => {
      const now = new Date().toISOString();
      const earlier = "2026-10-01T09:00:00.000Z";
      // Two turns open by their timestamps, and one that has replied.
      await database.exec(`
        INSERT INTO agent_conversation (id, organization_id, kind, user_id, session_id, message_count, last_message_at, last_assistant_at, last_read_at) VALUES
          ('busy', 'org_a', 'BUILDER', 'user_a', 'chat.busy', 1, '${now}', NULL, '${now}'),
          ('failed', 'org_a', 'BUILDER', 'user_a', 'chat.failed', 1, '${now}', NULL, '${now}'),
          ('done', 'org_a', 'BUILDER', 'user_a', 'chat.done', 2, '${earlier}', '${earlier}', '${now}');
      `);
      answering.add("chat.busy");

      const chats = await BuilderService.listConversations(owner);
      expect(
        Object.fromEntries(chats.map((chat) => [chat.id, chat.state])),
      ).toEqual({ busy: "working", failed: "idle", done: "idle" });
      // A chat whose last turn replied is not woken to ask.
      expect(asked).not.toHaveBeenCalledWith("chat.done");
    });

    it("offers the organization's most recently active records before anything is typed", async () => {
      await database.exec(`
        INSERT INTO company (id, organization_id, name, last_activity_at, archived_at) VALUES
          ('acme', 'org_a', 'Acme', '2026-10-10T09:00:00.000Z', NULL),
          ('bolt', 'org_a', 'Bolt', NULL, NULL),
          ('cobalt', 'org_a', 'Cobalt', '2026-10-15T09:00:00.000Z', NULL),
          ('gone', 'org_a', 'Gone', '2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'),
          ('theirs', 'org_b', 'Acme Two', '2026-10-17T09:00:00.000Z', NULL);
      `);
      const records = async (q: string) =>
        (await BuilderService.searchResources(owner, q))
          .filter((resource) => resource.kind !== "integration")
          .map((resource) => resource.label);

      expect(await records("")).toEqual(["Cobalt", "Acme", "Bolt"]);
      expect(await records("ac")).toEqual(["Acme"]);
    });
  });
}
