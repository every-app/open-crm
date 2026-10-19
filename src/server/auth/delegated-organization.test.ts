import { describe, expect, it, vi } from "vitest";

// A member's request notes the day they were seen, once a day, and a member
// back after 30 days away has their paused mailbox syncs carry on.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { ensureEveryAppMembership } from "./delegated-organization";

describe("ensureEveryAppMembership", () => {
  it("notes the day a member is seen, and resumes the syncs paused while they were away", async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    const organizationId = "org_a";
    const userId = "user_a";
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
