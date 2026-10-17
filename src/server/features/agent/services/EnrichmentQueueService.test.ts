import { beforeEach, describe, expect, it, vi } from "vitest";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: database.db }));

import { EnrichmentQueueService } from "./EnrichmentQueueService";

const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("EnrichmentQueueService", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM agent_task; DELETE FROM deal; DELETE FROM contact; DELETE FROM company; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, icon_url, logo_url) VALUES ('co_a', 'org_a', 'Fernhill', NULL, '/api/images/org_a/logo.png');
       INSERT INTO contact (id, organization_id, first_name, last_name) VALUES ('c_a', 'org_a', 'Paula', 'Marchetti');
       INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d_a', 'org_a', 'Fernhill renewal', 'co_a', 'user_a');
       INSERT INTO agent_task (id, organization_id, company_id, contact_id, deal_id, kind, reason, priority, attempts, due_at, leased_until, started_at, finished_at) VALUES
         ('brand', 'org_a', 'co_a', NULL, NULL, 'brand', 'New company', 900, 1, '${PAST}', '${FUTURE}', '${PAST}', NULL),
         ('identify', 'org_a', NULL, 'c_a', NULL, 'identify', 'New contact', 100, 0, '${PAST}', NULL, NULL, NULL),
         ('backfill', 'org_a', NULL, NULL, 'd_a', 'field-backfill', 'New field', 20, 3, '${PAST}', NULL, '${PAST}', NULL),
         ('recheck', 'org_a', NULL, 'c_a', NULL, 'recheck', 'A job change here would move the renewal', 0, 0, '${FUTURE}', NULL, NULL, NULL),
         ('done', 'org_a', NULL, 'c_a', NULL, 'portrait', 'New contact', 800, 1, '${PAST}', NULL, '${PAST}', '${PAST}'),
         ('ours', 'org_a', NULL, NULL, NULL, 'workspace-profile', 'Our website', 500, 0, '${PAST}', NULL, NULL, NULL);`,
    );
  });

  it("lists what the agent is doing now, most urgent first, and what it has booked", async () => {
    expect(await EnrichmentQueueService.queue("org_a", 20)).toEqual({
      rows: [
        {
          id: "brand",
          kind: "brand",
          state: "running",
          startedAt: PAST,
          subject: {
            kind: "company",
            id: "co_a",
            name: "Fernhill",
            logoUrl: "/api/images/org_a/logo.png",
            logoDarkUrl: null,
            logoTone: null,
          },
        },
        {
          id: "identify",
          kind: "identify",
          state: "queued",
          startedAt: null,
          subject: {
            kind: "contact",
            id: "c_a",
            name: "Paula Marchetti",
            imageUrl: null,
          },
        },
        {
          id: "backfill",
          kind: "field-backfill",
          state: "failed",
          startedAt: PAST,
          subject: { kind: "deal", id: "d_a", name: "Fernhill renewal" },
        },
      ],
      total: 3,
      scheduled: [
        {
          id: "recheck",
          kind: "recheck",
          dueAt: FUTURE,
          reason: "A job change here would move the renewal",
          subject: {
            kind: "contact",
            id: "c_a",
            name: "Paula Marchetti",
            imageUrl: null,
          },
        },
      ],
      scheduledTotal: 1,
    });
  });

  it("pages the list while counting all of it", async () => {
    const page = await EnrichmentQueueService.queue("org_a", 1);
    expect(page.rows.map((row) => row.id)).toEqual(["brand"]);
    expect(page.total).toBe(3);
  });

  it("keeps each organization's queue, and its records, to itself", async () => {
    expect(await EnrichmentQueueService.queue("org_b", 20)).toEqual({
      rows: [],
      total: 0,
      scheduled: [],
      scheduledTotal: 0,
    });
    // A task naming another organization's contact never shows that contact.
    await database.exec(
      `INSERT INTO agent_task (id, organization_id, contact_id, kind, reason, priority, due_at) VALUES ('stray', 'org_b', 'c_a', 'identify', 'New contact', 100, '${PAST}');`,
    );
    expect(await EnrichmentQueueService.queue("org_b", 20)).toMatchObject({
      rows: [],
      total: 1,
    });
  });
});
