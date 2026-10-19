import { beforeEach, describe, expect, it, vi } from "vitest";

// Get started's progress: each step counts only what the
// organization (and, for the inbox, the person) has done.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { SetupRepository } from "./SetupRepository";

const NOTHING = {
  companies: false,
  inbox: false,
  agent: false,
  tracking: false,
  team: false,
};

describe("SetupRepository", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM tracked_event; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
  });

  it("counts one organization's progress, and the person's own inbox", async () => {
    await database.exec(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@b.test', true);
         INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', 'org_b', 'user_c', 'member', '2026-01-01T00:00:00.000Z');
         INSERT INTO company (id, organization_id, name) VALUES ('co1', 'org_b', 'Acme');
         INSERT INTO mailbox_connection (id, organization_id, user_id, provider, account_email, scopes) VALUES ('mb1', 'org_b', 'user_b', 'google', 'bo@b.test', 'x');
         INSERT INTO agent_definition (id, organization_id, name, status, created_by_id) VALUES ('ag1', 'org_b', 'Flagger', 'LIVE', 'user_b');
         INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ('e1', 'org_b', 'v1', 'page_view', 'b.test', '/', '2026-01-01T00:00:00.000Z');`,
    );

    expect(await SetupRepository.progress("org_b", "user_b")).toEqual({
      companies: true,
      inbox: true,
      agent: true,
      tracking: true,
      team: true,
    });
    // The inbox is the person's own; the rest is the workspace's.
    expect(await SetupRepository.progress("org_b", "user_c")).toEqual({
      companies: true,
      inbox: false,
      agent: true,
      tracking: true,
      team: true,
    });
    expect(await SetupRepository.progress("org_a", "user_a")).toEqual(NOTHING);
  });

  it("leaves out archived companies and agents that were never deployed", async () => {
    await database.exec(
      `INSERT INTO company (id, organization_id, name, archived_at) VALUES ('co1', 'org_a', 'Gone', '2026-01-01T00:00:00.000Z');
         INSERT INTO agent_definition (id, organization_id, name, status, created_by_id) VALUES ('ag1', 'org_a', 'Draft', 'DRAFT', 'user_a');`,
    );

    expect(await SetupRepository.progress("org_a", "user_a")).toEqual(NOTHING);
  });
});
