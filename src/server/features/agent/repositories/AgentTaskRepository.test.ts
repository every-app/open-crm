import { beforeEach, describe, expect, it, vi } from "vitest";

// The queue's "one open task of a kind per subject" rule is a partial unique
// index plus a portable upsert; both backends must agree on it.
const { databases, current } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: { dialect: "sqlite" as "sqlite" | "postgres" },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
  },
}));
vi.mock("@/db", () => ({
  get db() {
    return databases[current.dialect].db;
  },
}));

import { AgentTaskRepository } from "./AgentTaskRepository";

const task = (organizationId: string) => ({
  organizationId,
  kind: "identify",
  reason: "New contact",
  priority: 100,
  budget: 4,
  subject: "contact:c1",
  contactId: "c1",
});

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`AgentTaskRepository (${dialect})`, () => {
    const database = databases[dialect];
    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
    });

    it("keeps one open task of a kind per subject", async () => {
      expect(await AgentTaskRepository.insertIfAbsent(task("org_a"))).toBe(
        true,
      );
      expect(await AgentTaskRepository.insertIfAbsent(task("org_a"))).toBe(
        false,
      );
      expect(await database.rows("SELECT id FROM agent_task")).toHaveLength(1);
    });

    it("scopes the rule, and every lookup, to the organization", async () => {
      expect(await AgentTaskRepository.insertIfAbsent(task("org_a"))).toBe(
        true,
      );
      expect(await AgentTaskRepository.insertIfAbsent(task("org_b"))).toBe(
        true,
      );
      const mine = await AgentTaskRepository.findOpen(
        "org_a",
        "identify",
        "contact:c1",
      );
      expect(mine?.organizationId).toBe("org_a");
      expect(
        await AgentTaskRepository.findById("org_b", mine?.id ?? ""),
      ).toBeNull();
      expect(
        await AgentTaskRepository.complete(
          "org_b",
          mine?.id ?? "",
          "not yours",
        ),
      ).toBeNull();
    });

    it("queues again once the open task finished", async () => {
      await AgentTaskRepository.insertIfAbsent(task("org_a"));
      await database.exec(
        "UPDATE agent_task SET finished_at = '2026-10-16T00:00:00.000Z'",
      );
      expect(await AgentTaskRepository.insertIfAbsent(task("org_a"))).toBe(
        true,
      );
    });

    it("finishes a task once", async () => {
      await AgentTaskRepository.insertIfAbsent(task("org_a"));
      const open = await AgentTaskRepository.findOpen(
        "org_a",
        "identify",
        "contact:c1",
      );
      const id = open?.id ?? "";
      expect(
        await AgentTaskRepository.complete("org_a", id, "ran"),
      ).toMatchObject({
        id,
        contactId: "c1",
        kind: "identify",
      });
      expect(
        await AgentTaskRepository.complete("org_a", id, "ran again"),
      ).toBeNull();
    });

    it("moves a booked recheck rather than booking a second one", async () => {
      const recheck = (dueAt: string, reason: string) =>
        AgentTaskRepository.schedule({
          ...task("org_a"),
          kind: "recheck",
          dueAt,
          reason,
        });
      const first = await recheck("2026-11-01T00:00:00.000Z", "first look");
      const second = await recheck(
        "2027-01-01T00:00:00.000Z",
        "a job change here would move the Acme deal",
      );
      expect(second?.id).toBe(first?.id);
      const rows = await database.rows("SELECT due_at, reason FROM agent_task");
      expect(rows).toEqual([
        expect.objectContaining({
          due_at: "2027-01-01T00:00:00.000Z",
          reason: "a job change here would move the Acme deal",
        }),
      ]);
    });
  });
}
