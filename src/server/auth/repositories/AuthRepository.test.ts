import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Members lists the mirrored members with when each joined, a
// timestamp each dialect stores its own way.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { AuthRepository } from "./AuthRepository";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`AuthRepository.listMembers (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("lists one organization's members, oldest first, with when each joined", async () => {
      await AuthRepository.upsertMember({
        organizationId: "org_a",
        userId: "user_b",
        role: "member",
        seenAt: new Date().toISOString(),
      });

      const members = await AuthRepository.listMembers("org_a");
      expect(members.map(({ userId, role }) => ({ userId, role }))).toEqual([
        { userId: "user_a", role: "owner" },
        { userId: "user_b", role: "member" },
      ]);
      expect(members[0]?.joinedAt).toBe("1970-01-01T00:00:00.000Z");
      expect(members[1]?.joinedAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      expect(
        (await AuthRepository.listMembers("org_b")).map((row) => row.userId),
      ).toEqual(["user_b"]);
    });
  });
}
