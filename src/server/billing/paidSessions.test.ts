import { beforeEach, describe, expect, it, vi } from "vitest";

// A claim is a conditional upsert on the slot number in the key: both
// backends must agree on who gets a slot.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { PaidSessionRepository, type PaidSessionClaim } from "./paidSessions";

const claim = (
  sessionId: string,
  {
    kind = "research",
    organizationId = "org_a",
  }: Partial<PaidSessionClaim> = {},
) =>
  PaidSessionRepository.claim({
    organizationId,
    kind,
    sessionId,
    leaseMs: 60_000,
  });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`paid session slots (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM paid_session; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
    });

    it("holds three sessions of a kind per organization, freed when one ends or its lease lapses", async () => {
      expect(await claim("a")).toBe(true);
      expect(await claim("b")).toBe(true);
      // Two claimers for the last slot: one gets it.
      expect(await Promise.all([claim("c"), claim("d")])).toEqual(
        expect.arrayContaining([true, false]),
      );
      expect(await claim("e")).toBe(false);
      // A session asking again keeps its own slot.
      expect(await claim("a")).toBe(true);
      // Chats have slots of their own.
      expect(await claim("chat", { kind: "chat" })).toBe(true);

      await PaidSessionRepository.release("org_a", "b");
      expect(await claim("e")).toBe(true);
      await database.exec(
        `UPDATE paid_session SET leased_until = '2000-01-01T00:00:00.000Z' WHERE session_id = 'a'`,
      );
      expect(await claim("f")).toBe(true);
      expect(await claim("g")).toBe(false);
    });

    it("keeps each organization's slots apart", async () => {
      for (const sessionId of ["a", "b", "c"]) await claim(sessionId);

      expect(await claim("b-1", { organizationId: "org_b" })).toBe(true);
      // org_b ending a session of the same name frees nothing of org_a's.
      await PaidSessionRepository.release("org_b", "a");
      expect(await claim("d")).toBe(false);
    });
  });
}
