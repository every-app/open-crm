import { beforeEach, describe, expect, it, vi } from "vitest";

// Erasing an organization on both backends: its rows, its people who belong
// nowhere else, its grants, its agents' Durable Objects and its R2 objects
// go; another organization keeps everything, a shared member included.
const { testDb, objects, destroyed } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return {
    testDb: await createDualDialectTestDb(),
    objects: new Set<string>(),
    destroyed: [] as string[],
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return testDb.modules.workers.env.DATABASE_PROVIDER;
    },
    CRM_AGENT: {},
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
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
vi.mock("agents", () => ({
  getAgentByName: async (_namespace: unknown, name: string) => ({
    destroy: async () => {
      destroyed.push(name);
    },
  }),
}));

import { sort } from "remeda";
import { sessionName } from "@/server/features/agent/sessionName";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { stubProviders } from "@/server/features/mailbox/mailboxTestSupport";
import { OrganizationErasureService } from "./OrganizationErasureService";

const CHAT = sessionName(
  "chat",
  "org_a",
  "11111111-2222-3333-4444-555555555555",
);
const TASK = sessionName(
  "task",
  "org_a",
  "aaaaaaaa-0000-0000-0000-000000000001",
);

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`OrganizationErasureService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      objects.clear();
      destroyed.length = 0;
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("lists, then erases, everything of the organization and nothing of another's", async () => {
      // Cy is a member of both organizations; Ana only of org_a.
      await database.exec(`
        INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@c.test', true);
        INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
          ('m_ca', 'org_a', 'user_c', 'member', '2026-01-01T00:00:00.000Z'),
          ('m_cb', 'org_b', 'user_c', 'member', '2026-01-01T00:00:00.000Z');
        INSERT INTO company (id, organization_id, name) VALUES ('co_a', 'org_a', 'Acme'), ('co_b', 'org_b', 'Other');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('d_a', 'org_a', 'Pilot', 'co_a', 'user_a');
        INSERT INTO agent_task (id, organization_id, kind, reason, due_at, session_id) VALUES ('t_a', 'org_a', 'identify', 'r', '2026-01-01T00:00:00.000Z', '${TASK}');
        INSERT INTO agent_conversation (id, organization_id, company_id, user_id, session_id) VALUES ('c_a', 'org_a', 'co_a', 'user_a', '${CHAT}');
        INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ('ev_a', 'org_a', 'v1', 'page_view', 'acme.test', '/', '2026-01-01T00:00:00.000Z');
        INSERT INTO slack_connection (id, organization_id, team_id, bot_token, bot_scopes) VALUES ('s_a', 'org_a', 'T1', 'xoxb-a', 'chat:write');
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
        "slack.com/api/auth.revoke": () => {
          called.push("slack");
          return { ok: true, revoked: true };
        },
      });

      const listed = await OrganizationErasureService.inventory("org_a");
      expect(listed).toMatchObject({
        exists: true,
        rows: { company: 1, deal: 1, agent_task: 1, tracked_event: 1 },
        sessions: 2,
        objects: 2,
      });
      expect(
        listed.members.map(({ userId, erasedWithIt }) => ({
          userId,
          erasedWithIt,
        })),
      ).toEqual(
        expect.arrayContaining([
          { userId: "user_a", erasedWithIt: true },
          { userId: "user_c", erasedWithIt: false },
        ]),
      );
      // A dry run changes nothing.
      expect(await database.rows("SELECT id FROM company")).toHaveLength(2);

      let step = await OrganizationErasureService.eraseNext("org_a");
      while (!step.done)
        step = await OrganizationErasureService.eraseNext("org_a");

      expect(step.erased).toMatchObject({
        mailboxes: 1,
        slackTokens: 1,
        users: 1,
      });
      expect(sort(called, (a, b) => a.localeCompare(b))).toEqual([
        "google",
        "slack",
      ]);
      expect(destroyed).toEqual(expect.arrayContaining([CHAT, TASK]));
      expect(destroyed).toHaveLength(2);
      expect([...objects]).toEqual(["org_b/logo-2.png"]);
      expect(await OrganizationErasureService.inventory("org_a")).toMatchObject(
        {
          exists: false,
          rows: {},
          members: [],
          mailboxes: [],
          slack: null,
          sessions: 0,
          objects: 0,
        },
      );
      expect(await database.rows(`SELECT id FROM "user" ORDER BY id`)).toEqual([
        { id: "user_b" },
        { id: "user_c" },
      ]);
      expect(await database.rows("SELECT id FROM company")).toEqual([
        { id: "co_b" },
      ]);
    });
  });
}
