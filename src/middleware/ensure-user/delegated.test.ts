import { beforeEach, describe, expect, it, vi } from "vitest";

// A member's first page load sends several requests at once, each of which
// may create their row; and a member the gateway removed and invited again
// comes back under a new id with the same email, which `user.email` keeps
// unique. (The index-level race between first requests shows only on a real
// Postgres, where it was checked; here they interleave at each statement.)
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

    it("lets a re-invited member in under their new id however many first requests race; the old row keeps its membership and gives the email up", async () => {
      await Promise.all(
        [1, 2, 3].map(() => ensureUserRecord("user_a2", "ana@a.test")),
      );

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
