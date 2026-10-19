import { beforeEach, describe, expect, it, vi } from "vitest";

// A member the gateway removed and invited again comes back under a new id
// with the same email, which `user.email` keeps unique.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { ensureUserRecord } from "./delegated";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ensureUserRecord (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("lets a re-invited member in under their new id; the old row keeps its membership and gives the email up", async () => {
      await ensureUserRecord("user_a2", "ana@a.test");

      expect(
        await database.rows(
          `SELECT u.id, u.email, m.organization_id FROM "user" u LEFT JOIN member m ON m.user_id = u.id WHERE u.id IN ('user_a', 'user_a2') ORDER BY u.id`,
        ),
      ).toEqual([
        {
          id: "user_a",
          email: "user_a@replaced.invalid",
          organization_id: "org_a",
        },
        { id: "user_a2", email: "ana@a.test", organization_id: null },
      ]);
    });
  });
}
