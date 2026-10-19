import { describe, expect, it, vi } from "vitest";

// A member's request notes the day they were seen, once a day, and a member
// back after 30 days away has their paused mailbox syncs carry on.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { ensureEveryAppMembership } from "./delegated-organization";

// The module remembers, per isolate, whom it saw today: each dialect's run
// uses its own member, so the second run isn't answered from that memory.
const MEMBER = {
  sqlite: { organizationId: "org_a", userId: "user_a" },
  postgres: { organizationId: "org_b", userId: "user_b" },
} as const;

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ensureEveryAppMembership (${dialect})`, () => {
    const database = testDb.use(dialect);

    it("notes the day a member is seen, and resumes the syncs paused while they were away", async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      const { organizationId, userId } = MEMBER[dialect];
      await database.exec(
        `UPDATE member SET last_seen_at = '2026-01-01T00:00:00.000Z' WHERE user_id = '${userId}';
         INSERT INTO mailbox_sync (id, organization_id, user_id, source, status) VALUES ('s1', '${organizationId}', '${userId}', 'gmail', 'PAUSED');`,
      );

      await ensureEveryAppMembership({ organizationId, userId, role: "owner" });

      const today = new Date().toISOString().slice(0, 10);
      expect(
        await database.rows(
          `SELECT substr(last_seen_at, 1, 10) AS day FROM member WHERE user_id = '${userId}'`,
        ),
      ).toEqual([{ day: today }]);
      expect(
        await database.rows(
          "SELECT status FROM mailbox_sync WHERE next_sync_at IS NOT NULL",
        ),
      ).toEqual([{ status: "IDLE" }]);
    });
  });
}
