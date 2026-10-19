import { beforeEach, describe, expect, it, vi } from "vitest";

// Retention rolls page views up as it deletes them, for every organization,
// counting each event once, in the batch that deletes it.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { TrackingRetentionService } from "./TrackingRetentionService";

const NOW = new Date("2026-10-17T04:00:00.000Z");
// The cutoff is 2026-07-19T00:00Z: 90 days back, at midnight.
const OLD_DAY = "2026-07-18";

function event(
  id: string,
  organizationId: string,
  visitorId: string,
  type: string,
  occurredAt: string,
) {
  return `('${id}', '${organizationId}', '${visitorId}', '${type}', 'acme.com', '/pricing', '${occurredAt}')`;
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`TrackingRetentionService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM tracked_event; DELETE FROM tracked_page_daily; DELETE FROM tracked_visitor; DELETE FROM tracking_counter; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
    });

    const insertEvents = (rows: string[]) =>
      database.exec(
        `INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ${rows.join(", ")};`,
      );

    it("rolls up whole old days per organization, then deletes them", async () => {
      await insertEvents([
        event("e1", "org_a", "v1", "page_view", `${OLD_DAY}T09:00:00.000Z`),
        event("e2", "org_a", "v1", "page_view", `${OLD_DAY}T23:59:59.000Z`),
        event("e3", "org_a", "v2", "page_view", `${OLD_DAY}T10:00:00.000Z`),
        // Clicks are not page views.
        event("e4", "org_a", "v3", "click", `${OLD_DAY}T10:00:00.000Z`),
        event("e5", "org_b", "v9", "page_view", `${OLD_DAY}T10:00:00.000Z`),
        // The boundary day is kept whole for a later run.
        event("e6", "org_a", "v1", "page_view", "2026-07-19T00:00:00.000Z"),
      ]);
      await database.exec(
        `INSERT INTO tracking_counter (organization_id, key, value, expires_at) VALUES
           ('org_a', 'site:1', 5, '2026-10-17T03:00:00.000Z'),
           ('org_a', 'site:2', 5, '2026-10-17T05:00:00.000Z');
         INSERT INTO contact (id, organization_id, first_name) VALUES ('c1', 'org_a', 'Jane');
         INSERT INTO tracked_visitor (organization_id, id, contact_id, last_seen) VALUES
           ('org_a', 'gone', NULL, '${OLD_DAY}T09:00:00.000Z'),
           ('org_a', 'known', 'c1', '${OLD_DAY}T09:00:00.000Z');
         INSERT INTO form_submission (id, organization_id, contact_id, host, path, email, fields, dedupe_key, created_at) VALUES
           ('f_old', 'org_a', 'c1', 'acme.com', '/contact', 'jane@x.test', '{}', 'k1', '${OLD_DAY}T09:00:00.000Z'),
           ('f_new', 'org_b', NULL, 'acme.com', '/contact', 'bo@x.test', '{}', 'k2', '2026-07-19T00:00:00.000Z');`,
      );

      const totals = await TrackingRetentionService.sweep(NOW);

      expect(totals).toMatchObject({
        events: 5,
        complete: true,
        submissions: 1,
        visitors: 1,
        counters: 1,
      });
      expect(await database.rows("SELECT id FROM form_submission")).toEqual([
        { id: "f_new" },
      ]);
      expect(
        await database.rows(
          "SELECT organization_id, day, views, visitors FROM tracked_page_daily ORDER BY organization_id",
        ),
      ).toEqual([
        { organization_id: "org_a", day: OLD_DAY, views: 3, visitors: 2 },
        { organization_id: "org_b", day: OLD_DAY, views: 1, visitors: 1 },
      ]);
      expect(await database.rows("SELECT id FROM tracked_event")).toEqual([
        { id: "e6" },
      ]);
      expect(await database.rows("SELECT key FROM tracking_counter")).toEqual([
        { key: "site:2" },
      ]);
      // A visitor outlives their events only while a contact points at them.
      expect(await database.rows("SELECT id FROM tracked_visitor")).toEqual([
        { id: "known" },
      ]);
    });

    it("adds a day's events rolled in a later run to its count", async () => {
      await insertEvents([
        event("e1", "org_a", "v1", "page_view", `${OLD_DAY}T09:00:00.000Z`),
        event("e2", "org_a", "v2", "page_view", `${OLD_DAY}T10:00:00.000Z`),
      ]);
      await TrackingRetentionService.sweep(NOW);
      // A straggler of the same day, after its events were swept.
      await insertEvents([
        event("e3", "org_a", "v3", "page_view", `${OLD_DAY}T11:00:00.000Z`),
      ]);
      await TrackingRetentionService.sweep(NOW);
      expect(
        await database.rows("SELECT views, visitors FROM tracked_page_daily"),
      ).toEqual([{ views: 3, visitors: 3 }]);
    });
  });
}
