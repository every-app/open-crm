import { beforeEach, describe, expect, it, vi } from "vitest";

// Erasing an organization: its rows, its people, its grants and its R2
// objects go; another organization keeps everything.
const { database, objects } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    objects: new Set<string>(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    R2: {
      list: async ({ prefix }: { prefix: string }) => ({
        objects: [...objects]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      }),
      delete: async (keys: string[]) => {
        for (const key of keys) objects.delete(key);
      },
    },
  },
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { stubProviders } from "@/server/features/mailbox/mailboxTestSupport";
import { OrganizationErasureService } from "./OrganizationErasureService";

describe("OrganizationErasureService", () => {
  beforeEach(async () => {
    objects.clear();
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  it("lists, then erases, everything of the organization and nothing of another's", async () => {
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('co_a', 'org_a', 'Acme'), ('co_b', 'org_b', 'Other');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d_a', 'org_a', 'Pilot', 'co_a', 'user_a');
        INSERT INTO agent_task (id, organization_id, kind, reason, due_at) VALUES ('t_a', 'org_a', 'identify', 'r', '2026-01-01T00:00:00.000Z');
        INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ('ev_a', 'org_a', 'v1', 'page_view', 'acme.test', '/', '2026-01-01T00:00:00.000Z');
      `);
    await seedMailbox({
      organizationId: "org_a",
      userId: "user_a",
      provider: "google",
      accountEmail: "ana@a.test",
      sources: ["gmail"],
    });
    objects.add("org_a/logo-1.png");
    objects.add("builder-attachments/org_a/c/f");
    objects.add("org_b/logo-2.png");
    const called: string[] = [];
    stubProviders({
      "oauth2.googleapis.com/revoke": () => {
        called.push("google");
        return new Response(null, { status: 200 });
      },
    });

    const listed = await OrganizationErasureService.inventory("org_a");
    expect(listed).toMatchObject({
      exists: true,
      rows: { company: 1, deal: 1, agent_task: 1, tracked_event: 1 },
      objects: 2,
    });
    expect(listed.members.map(({ userId }) => userId)).toEqual(["user_a"]);
    // A dry run changes nothing.
    expect(await database.rows("SELECT id FROM company")).toHaveLength(2);

    let step = await OrganizationErasureService.eraseNext("org_a");
    while (!step.done)
      step = await OrganizationErasureService.eraseNext("org_a");

    expect(step.erased).toMatchObject({
      mailboxes: 1,
      users: 1,
    });
    expect(called).toEqual(["google"]);
    expect([...objects]).toEqual(["org_b/logo-2.png"]);
    expect(await OrganizationErasureService.inventory("org_a")).toMatchObject({
      exists: false,
      rows: {},
      members: [],
      mailboxes: [],
      objects: 0,
    });
    expect(await database.rows(`SELECT id FROM "user" ORDER BY id`)).toEqual([
      { id: "user_b" },
    ]);
    expect(await database.rows("SELECT id FROM company")).toEqual([
      { id: "co_b" },
    ]);
  });
});
