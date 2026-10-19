import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DIRECT_KINDS, MAX_ATTEMPTS, PRIORITY } from "@/shared/agent-tasks";

// The dispatcher's lease is a conditional update on leased_until (no SKIP
// LOCKED on D1): both backends must agree on who gets a row.
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

import { AgentQueueRepository, type TaskLane } from "./AgentQueueRepository";

const VISIBLE: TaskLane = { only: DIRECT_KINDS };
const RESEARCH: TaskLane = { except: DIRECT_KINDS };
const rowsSchema = z.array(z.record(z.string(), z.unknown()));
const LEASE_MS = 60_000;

const past = (ms = 1000) => new Date(Date.now() - ms).toISOString();

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`the agent queue (${dialect})`, () => {
    const database = databases[dialect];
    let next = 0;

    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(
        `DELETE FROM agent_task; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
    });

    async function queue(
      fields: {
        kind?: string;
        priority?: number;
        dueAt?: string;
        organizationId?: string;
        attempts?: number;
        leasedUntil?: string | null;
        contactId?: string;
      } = {},
    ): Promise<string> {
      next += 1;
      const id = `task-${next}`;
      await database.exec(
        `INSERT INTO agent_task (id, organization_id, kind, reason, priority, budget, attempts, due_at, leased_until, contact_id, subject)
         VALUES ('${id}', '${fields.organizationId ?? "org_a"}', '${fields.kind ?? "identify"}', 'test',
                 ${fields.priority ?? 0}, 4, ${fields.attempts ?? 0}, '${fields.dueAt ?? past()}',
                 ${fields.leasedUntil ? `'${fields.leasedUntil}'` : "NULL"},
                 ${fields.contactId ? `'${fields.contactId}'` : "NULL"}, 'subject-${id}')`,
      );
      return id;
    }

    const claim = (
      lane: TaskLane = RESEARCH,
      extra: {
        organizationId?: string;
        perOrganization?: number;
      } = {},
    ) =>
      AgentQueueRepository.claimDue({
        limit: 10,
        lane,
        leaseMs: LEASE_MS,
        ...extra,
      });

    it("leases due work and counts the attempt", async () => {
      const id = await queue();
      const [task] = await claim();
      expect(task).toMatchObject({ id, organizationId: "org_a", attempts: 1 });
      const [row] = rowsSchema.parse(
        await database.rows(
          `SELECT leased_until, started_at FROM agent_task WHERE id = '${id}'`,
        ),
      );
      expect(row?.leased_until).toBeTruthy();
      expect(row?.started_at).toBeTruthy();
    });

    it("never hands the same row to two dispatchers", async () => {
      await Promise.all([queue(), queue(), queue()]);
      const [first, second] = await Promise.all([claim(), claim()]);
      const ids = [...first, ...second].map((task) => task.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });

    it("leaves work that is not due yet", async () => {
      await queue({ dueAt: new Date(Date.now() + 60_000).toISOString() });
      expect(await claim()).toEqual([]);
    });

    it("takes the most urgent first", async () => {
      const low = await queue({ priority: PRIORITY.recheck });
      const high = await queue({ priority: PRIORITY.workspace });
      const claimed = await claim();
      expect(claimed.map((task) => task.id)).toEqual([high, low]);
    });

    it("lets organizations take turns, none past its share", async () => {
      const first = await queue({
        priority: PRIORITY.requested,
        dueAt: past(3000),
      });
      const second = await queue({
        priority: PRIORITY.requested,
        dueAt: past(2000),
      });
      await queue({ priority: PRIORITY.requested, dueAt: past(1000) });
      const other = await queue({
        organizationId: "org_b",
        priority: PRIORITY.recheck,
      });
      const claimed = await claim(RESEARCH, { perOrganization: 2 });
      expect(claimed.map((task) => task.id)).toEqual([first, other, second]);
    });

    it("holds the scheduled research of an organization that turned off Research automatically, not what a person asked for", async () => {
      await database.exec(
        `INSERT INTO workspace (organization_id, name, research_automatically) VALUES ('org_a', 'A', false)`,
      );
      await queue({ kind: "recheck", priority: PRIORITY.recheck });
      const asked = await queue({
        kind: "company-profile",
        priority: PRIORITY.requested,
      });
      const elsewhere = await queue({
        kind: "recheck",
        priority: PRIORITY.recheck,
        organizationId: "org_b",
      });
      const claimed = await claim();
      expect(claimed.map((task) => task.id)).toEqual([asked, elsewhere]);
    });

    it("re-claims a row only once its lease runs out, until its attempts are spent", async () => {
      const id = await queue({ attempts: MAX_ATTEMPTS - 1 });
      expect((await claim()).map((task) => task.id)).toEqual([id]);
      expect(await claim()).toEqual([]);
      await database.exec(
        `UPDATE agent_task SET leased_until = '${past()}' WHERE id = '${id}'`,
      );
      // Its last attempt was handed out above.
      expect(await claim()).toEqual([]);
      await database.exec(
        `UPDATE agent_task SET attempts = 1, leased_until = '${past()}' WHERE id = '${id}'`,
      );
      expect((await claim())[0]?.attempts).toBe(2);
    });

    it("keeps the visible and research lanes apart", async () => {
      const brand = await queue({ kind: "brand", priority: PRIORITY.brand });
      const profile = await queue({ kind: "company-profile" });
      expect((await claim(VISIBLE)).map((task) => task.id)).toEqual([brand]);
      expect((await claim(RESEARCH)).map((task) => task.id)).toEqual([profile]);
    });

    it("serves one organization's queue to its poke, and no one else's", async () => {
      await queue({ kind: "brand", organizationId: "org_a" });
      expect(await claim(VISIBLE, { organizationId: "org_b" })).toEqual([]);
      expect(await claim(VISIBLE, { organizationId: "org_a" })).toHaveLength(1);
    });

    it("retires a task that spent its attempts once its lease is gone", async () => {
      const spent = await queue({
        attempts: MAX_ATTEMPTS,
        leasedUntil: past(),
        contactId: "c1",
      });
      await queue({
        attempts: MAX_ATTEMPTS,
        leasedUntil: new Date(Date.now() + LEASE_MS).toISOString(),
      });
      await queue({ attempts: 1, leasedUntil: past() });
      const retired = await AgentQueueRepository.retireExhausted(10);
      expect(retired).toEqual([
        expect.objectContaining({
          id: spent,
          organizationId: "org_a",
          contactId: "c1",
        }),
      ]);
      const [row] = rowsSchema.parse(
        await database.rows(
          `SELECT finished_at, outcome FROM agent_task WHERE id = '${spent}'`,
        ),
      );
      expect(row?.finished_at).toBeTruthy();
      expect(String(row?.outcome)).toContain("Gave up");
    });
  });
}
