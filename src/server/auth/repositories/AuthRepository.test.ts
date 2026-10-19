import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Members lists the mirrored members with when each joined.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { AuthRepository } from "./AuthRepository";

describe("AuthRepository.listMembers", () => {
  beforeEach(async () => {
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
