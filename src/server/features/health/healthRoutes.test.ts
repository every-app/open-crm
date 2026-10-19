import type { EveryAppUser } from "@every-app/sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIORITY } from "@/shared/agent-tasks";

// The health checks at their routes. The dispatcher's counts are new SQL
// (aggregates, a conditional sum), so they run on both backends.
const { databases, current } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: {
      dialect: "sqlite" as "sqlite" | "postgres",
      databaseDown: false,
    },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
  },
}));
// The size comes from D1's own report or from Postgres, neither of which the
// test databases give.
vi.mock("@/db/maintenance", () => ({
  databaseSize: () => Promise.resolve({ provider: "d1", sizeBytes: 4096 }),
}));
vi.mock("@/db", () => ({
  get db() {
    if (current.databaseDown) {
      return {
        select: () => {
          throw new Error("connection refused");
        },
      };
    }
    return databases[current.dialect].db;
  },
}));
vi.mock("@/db/runBatch", () => ({
  get runBatch() {
    return databases[current.dialect].runBatch;
  },
}));

import { DispatchHealthRepository } from "@/server/features/agent/repositories/DispatchHealthRepository";
import { serveDispatchHealth, serveHealth } from "./healthRoutes";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const aTime: unknown = expect.any(String);

function person(overrides: Partial<EveryAppUser> = {}): EveryAppUser {
  return {
    id: "user_a",
    email: "ana@a.test",
    orgId: "org_a",
    orgRole: "owner",
    channel: "web",
    actor: { sub: "user_a" },
    scopes: ["*"],
    jti: "jti",
    ...overrides,
  };
}

describe("the public health check", () => {
  beforeEach(() => {
    current.dialect = "sqlite";
    current.databaseDown = false;
  });

  it("says whether the database answers, and nothing else", async () => {
    const up = await serveHealth();
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ status: "ok", database: "up" });

    current.databaseDown = true;
    const down = await serveHealth();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: "error", database: "down" });
  });
});

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the dispatcher's health check (${dialect})`, () => {
    const database = databases[dialect];

    beforeEach(async () => {
      current.dialect = dialect;
      current.databaseDown = false;
      await database.exec(
        `DELETE FROM dispatcher_lane; DELETE FROM agent_task; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await DispatchHealthRepository.recordLanes(
        (["visible", "research", "runs"] as const).map((lane) => ({
          lane,
          failed: false,
        })),
      );
    });

    async function queue(
      id: string,
      fields: { kind: string; dueAt: string; organizationId?: string },
    ) {
      await database.exec(
        `INSERT INTO agent_task (id, organization_id, kind, reason, priority, due_at, subject)
         VALUES ('${id}', '${fields.organizationId ?? "org_a"}', '${fields.kind}', 'test', ${PRIORITY.brand}, '${fields.dueAt}', 'subject-${id}')`,
      );
    }

    it("shows an owner when each lane ran and their own organization's backlog", async () => {
      const dueAt = ago(MINUTE);
      await queue("mine", { kind: "brand", dueAt });
      await queue("theirs", {
        kind: "brand",
        dueAt: ago(30 * MINUTE),
        organizationId: "org_b",
      });
      await database.exec(
        `INSERT INTO agent_definition (id, organization_id, name, status, created_by_id) VALUES
           ('ag_a', 'org_a', 'Flagger', 'LIVE', 'user_a'), ('ag_b', 'org_b', 'Flagger', 'LIVE', 'user_b');
         INSERT INTO agent_version (id, organization_id, agent_id, number, instructions, manifest, created_by_id) VALUES
           ('v_a', 'org_a', 'ag_a', 1, 'Flag.', '{}', 'user_a'), ('v_b', 'org_b', 'ag_b', 1, 'Flag.', '{}', 'user_b');
         INSERT INTO agent_run (id, organization_id, agent_id, version_id, trigger_type, idempotency_key) VALUES
           ('r_a', 'org_a', 'ag_a', 'v_a', 'MANUAL', 'r_a'), ('r_b', 'org_b', 'ag_b', 'v_b', 'MANUAL', 'r_b');`,
      );
      const response = await serveDispatchHealth(person());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        lanes: {
          visible: {
            lastRanAt: aTime,
            backlog: 1,
            oldestDueAt: dueAt,
            overdue: 0,
          },
          research: { backlog: 0 },
          runs: { backlog: 1, overdue: 0 },
        },
      });
    });

    it("is unhealthy while work sits overdue or a lane has stopped, but not for work held on purpose", async () => {
      // No model in the test environment: research waits for setup.
      await queue("held", { kind: "identify", dueAt: ago(30 * MINUTE) });
      const held = await serveDispatchHealth(person());
      expect(held.status).toBe(200);
      expect(await held.json()).toMatchObject({
        lanes: { research: { backlog: 1, overdue: 0, held: "setup" } },
      });

      await queue("logo", { kind: "brand", dueAt: ago(30 * MINUTE) });
      const overdue = await serveDispatchHealth(person());
      expect(overdue.status).toBe(503);
      expect(await overdue.json()).toMatchObject({
        ok: false,
        lanes: { visible: { overdue: 1 } },
      });

      await database.exec(
        `DELETE FROM agent_task WHERE id = 'logo'; UPDATE dispatcher_lane SET ran_at = '${ago(10 * MINUTE)}' WHERE lane = 'runs';`,
      );
      expect((await serveDispatchHealth(person())).status).toBe(503);
    });

    it("tells a member, or a token without the health scope, nothing", async () => {
      await queue("mine", { kind: "brand", dueAt: ago(MINUTE) });
      for (const caller of [
        person({ orgRole: "member" }),
        person({ scopes: ["mcp:read", "api:read"] }),
      ]) {
        const response = await serveDispatchHealth(caller);
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("Forbidden");
      }
      expect(
        (await serveDispatchHealth(person({ scopes: ["health"] }))).status,
      ).toBe(200);
    });
  });
}

describe("the dispatcher's health check", () => {
  beforeEach(async () => {
    current.dialect = "sqlite";
    current.databaseDown = false;
    await databases.sqlite.exec(
      `DELETE FROM dispatcher_lane; DELETE FROM agent_task; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await databases.sqlite.seedTwoOrganizations();
  });

  it("shows its owners the database's size", async () => {
    const response = await serveDispatchHealth(person());
    expect(await response.json()).toMatchObject({
      database: { provider: "d1", sizeBytes: 4096 },
    });
  });
});
