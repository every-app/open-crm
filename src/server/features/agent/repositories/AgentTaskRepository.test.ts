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
  describe(`AgentTaskRepository.insertIfAbsent (${dialect})`, () => {
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

    it("scopes the rule to the organization", async () => {
      expect(await AgentTaskRepository.insertIfAbsent(task("org_a"))).toBe(
        true,
      );
      expect(await AgentTaskRepository.insertIfAbsent(task("org_b"))).toBe(
        true,
      );
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
  });
}
