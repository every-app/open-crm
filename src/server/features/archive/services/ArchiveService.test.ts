import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The purge is guarded batches of subquery deletes and an INSERT ... SELECT
// ... ON CONFLICT, run against a real database.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { ArchiveService } from "./ArchiveService";

const idRow = z.object({ id: z.string() });

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe("ArchiveService", () => {
  const ids = async (table: string) =>
    (await database.rows(`SELECT id FROM ${table} ORDER BY id`)).map(
      (row) => idRow.parse(row).id,
    );

  beforeEach(async () => {
    await database.exec(`
        DELETE FROM suppressed_contact; DELETE FROM agent_event; DELETE FROM agent_task;
        DELETE FROM activity; DELETE FROM deal; DELETE FROM contact; DELETE FROM company;
        DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";
      `);
    await database.seedTwoOrganizations();
  });

  it("purges what was archived longer than the retention, with what goes with it", async () => {
    await database.exec(`
        INSERT INTO workspace (organization_id, name, archive_retention_days) VALUES ('org_a', 'A', 30);
        INSERT INTO company (id, organization_id, name, archived_at) VALUES
          ('c_old', 'org_a', 'Old', '${daysAgo(40)}'),
          ('c_recent', 'org_a', 'Recent', '${daysAgo(10)}'),
          ('c_live', 'org_a', 'Live', NULL),
          ('c_b', 'org_b', 'Other', '${daysAgo(400)}');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, archived_at) VALUES
          ('d_of_old', 'org_a', 'Of old', 'c_old', 'user_a', NULL),
          ('d_old', 'org_a', 'Old', 'c_live', 'user_a', '${daysAgo(40)}');
        INSERT INTO contact (id, organization_id, first_name, last_name, email, archived_at, last_activity_at) VALUES
          ('p_old', 'org_a', 'Ana', 'Old', 'ana@old.test', '${daysAgo(40)}', NULL),
          ('p_live', 'org_a', 'Bo', NULL, 'bo@live.test', NULL, '${daysAgo(1)}');
        INSERT INTO activity (id, organization_id, type, company_id, contact_id, created_at) VALUES
          ('act_shared', 'org_a', 'NOTE', 'c_old', 'p_live', '${daysAgo(1)}'),
          ('act_own', 'org_a', 'NOTE', NULL, 'p_live', '2026-01-02T00:00:00.000Z');
        INSERT INTO agent_task (id, organization_id, company_id, deal_id, contact_id, kind, reason, due_at) VALUES
          ('t_company', 'org_a', 'c_old', NULL, NULL, 'brand', 'r', '${daysAgo(50)}'),
          ('t_its_deal', 'org_a', NULL, 'd_of_old', NULL, 'recheck', 'r', '${daysAgo(50)}'),
          ('t_deal', 'org_a', NULL, 'd_old', NULL, 'recheck', 'r', '${daysAgo(50)}'),
          ('t_contact', 'org_a', NULL, NULL, 'p_old', 'identify', 'r', '${daysAgo(50)}'),
          ('t_live', 'org_a', 'c_live', NULL, NULL, 'brand', 'r', '${daysAgo(50)}');
        INSERT INTO agent_event (id, organization_id, session_id, company_id, deal_id, contact_id, type, data, emitted_at) VALUES
          ('e_company', 'org_a', 's', 'c_old', NULL, NULL, 'note', '{}', '${daysAgo(50)}'),
          ('e_its_deal', 'org_a', 's', NULL, 'd_of_old', NULL, 'note', '{}', '${daysAgo(50)}'),
          ('e_deal', 'org_a', 's', NULL, 'd_old', NULL, 'note', '{}', '${daysAgo(50)}'),
          ('e_contact', 'org_a', 's', NULL, NULL, 'p_old', 'note', '{}', '${daysAgo(50)}'),
          ('e_live', 'org_a', 's', 'c_live', NULL, NULL, 'note', '{}', '${daysAgo(50)}');
        INSERT INTO form_submission (id, organization_id, contact_id, host, path, email, fields, dedupe_key) VALUES
          ('f_filed', 'org_a', 'p_old', 'acme.test', '/contact', 'ana@old.test', '{}', 'k1'),
          ('f_unfiled', 'org_a', NULL, 'acme.test', '/contact', 'ana@old.test', '{}', 'k2'),
          ('f_live', 'org_a', 'p_live', 'acme.test', '/contact', 'bo@live.test', '{}', 'k3');
      `);

    expect(await ArchiveService.purgeExpiredArchives("org_a")).toEqual({
      retentionDays: 30,
      companies: 1,
      contacts: 1,
      deals: 1,
    });

    // The other organization's records are its own retention's business.
    expect(await ids("company")).toEqual(["c_b", "c_live", "c_recent"]);
    expect(await ids("deal")).toEqual([]);
    expect(await ids("contact")).toEqual(["p_live"]);
    expect(await ids("agent_task")).toEqual(["t_live"]);
    expect(await ids("agent_event")).toEqual(["e_live"]);
    // The person's form submissions, filed under them or not.
    expect(await ids("form_submission")).toEqual(["f_live"]);
    expect(
      await database.rows(
        "SELECT organization_id, email, reason FROM suppressed_contact",
      ),
    ).toMatchObject([
      {
        organization_id: "org_a",
        email: "ana@old.test",
        reason: "Deleted from the CRM (Ana Old)",
      },
    ]);
    // Its shared activity went with the company: the contact's last
    // activity is its own again.
    expect(
      await database.rows(
        "SELECT last_activity_at FROM contact WHERE id = 'p_live'",
      ),
    ).toMatchObject([{ last_activity_at: "2026-01-02T00:00:00.000Z" }]);
  });

  it("sweeps every organization by its own retention", async () => {
    await database.exec(`
        INSERT INTO workspace (organization_id, name, archive_retention_days) VALUES ('org_a', 'A', 30);
        INSERT INTO company (id, organization_id, name, archived_at) VALUES
          ('a_40', 'org_a', 'A 40', '${daysAgo(40)}'),
          ('b_40', 'org_b', 'B 40', '${daysAgo(40)}'),
          ('b_400', 'org_b', 'B 400', '${daysAgo(400)}');
      `);

    expect(await ArchiveService.purgeAllExpiredArchives()).toMatchObject({
      organizations: 2,
      companies: 2,
      failed: 0,
    });
    // org_b keeps archives the default 180 days.
    expect(await ids("company")).toEqual(["b_40"]);
  });
});
