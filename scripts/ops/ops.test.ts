import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPgTestDb, createSqliteTestDb } from "@/server/testing/testDb";
import { RETIRED_OUTCOME } from "@/shared/agent-tasks";
import type { Database } from "./db.ts";
import { dispatchHealth } from "./dispatch.ts";
import { lookupOrganization } from "./organization.ts";
import { requeueTask } from "./requeue.ts";

// The operator scripts' SQL is written once for both dialects, so each runs
// against SQLite (D1) and Postgres with every migration applied.

const DUE = "2026-01-01T00:00:00.000Z";

const rows = z.array(z.record(z.string(), z.unknown()));

describe.each([
  ["SQLite", createSqliteTestDb],
  ["Postgres", createPgTestDb],
])("operator scripts on %s", (_dialect, create) => {
  async function seeded() {
    const testDb = await create();
    await testDb.seedTwoOrganizations();
    await testDb.exec(`
      insert into company (id, organization_id, name) values ('co_a', 'org_a', 'Acme'), ('co_b', 'org_b', 'Bolt');
      insert into agent_task (id, organization_id, kind, reason, due_at, subject) values
        ('t_a', 'org_a', 'identify', 'New contact', '${DUE}', 'contact:c_a'),
        ('t_b', 'org_b', 'identify', 'New contact', '${DUE}', 'contact:c_b');
    `);
    const db: Database = {
      target: "test",
      query: async (sql) => rows.parse(await testDb.rows(sql)),
      close: async () => {},
    };
    return { testDb, db };
  }

  it("looks up one organization, by a member's email, without the other's rows", async () => {
    const { db } = await seeded();
    const found = await lookupOrganization(db, "ANA@a.test");
    expect(found.organization).toMatchObject({ id: "org_a" });
    expect(found.counts).toMatchObject({ company: 1, contact: 0 });
    expect(found.queue.tasks).toEqual([
      expect.objectContaining({ kind: "identify", open: 1, running: 0 }),
    ]);
  });

  it("requeues a retired task as a fresh copy due now, once", async () => {
    const { testDb, db } = await seeded();
    await testDb.exec(
      `update agent_task set attempts = 3, finished_at = '${DUE}', outcome = '${RETIRED_OUTCOME}' where id = 't_a'`,
    );
    expect(await requeueTask(db, "t_a", false)).toMatchObject({
      requeued: false,
    });
    const requeued = await requeueTask(db, "t_a", true);
    expect(requeued).toMatchObject({
      requeued: true,
      copy: { kind: "identify", subject: "contact:c_a" },
    });
    expect(await requeueTask(db, "t_a", true)).toMatchObject({
      requeued: false,
    });
    expect(
      await testDb.rows(
        "select id from agent_task where finished_at is null order by organization_id",
      ),
    ).toHaveLength(2);
  });

  it("reports overdue work by organization, and stalled lanes", async () => {
    const { testDb, db } = await seeded();
    await testDb.exec(
      `insert into dispatcher_lane (lane, ran_at) values ('visible', '${new Date().toISOString()}')`,
    );
    const health = await dispatchHealth(db);
    expect(health.ok).toBe(false);
    expect(health.lanes.filter((lane) => lane.stalled)).toHaveLength(2);
    expect(health.organizations).toEqual([
      expect.objectContaining({ organization_id: "org_a", overdue: 1 }),
      expect.objectContaining({ organization_id: "org_b", overdue: 1 }),
    ]);
  });
});
