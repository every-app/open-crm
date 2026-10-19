import { beforeEach, describe, expect, it, vi } from "vitest";

// Other members' mailboxes on both backends: what owners and admins see and
// do, and the syncs of members the CRM hasn't seen for 30 days.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { stubProviders } from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { ConnectionService } from "./ConnectionService";
import { MemberMailboxService } from "./MemberMailboxService";

const ANA = { organizationId: "org_a", userId: "user_a" };
const BO = { organizationId: "org_b", userId: "user_b" };

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`MemberMailboxService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    // Cy, a member of org_a whom the CRM has no sighting of.
    const CY = { organizationId: "org_a", userId: "user_c" };
    const addCy = () =>
      database.exec(
        `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@acme.com', true);
         INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', 'org_a', 'user_c', 'member', '2026-01-01T00:00:00.000Z');`,
      );

    it("shows owners and admins every member's connections and lets them disconnect one; a member reaches only their own", async () => {
      await addCy();
      await seedMailbox({
        ...CY,
        provider: "google",
        accountEmail: "cy@acme.com",
        sources: ["gmail"],
      });
      await seedMailbox({
        ...BO,
        provider: "microsoft",
        accountEmail: "bo@contoso.com",
        sources: ["outlook"],
      });
      const owner = { ...ANA, role: "owner" };
      const member = { ...ANA, role: "member" };

      expect(await MemberMailboxService.list(owner)).toMatchObject([
        {
          userId: "user_c",
          name: "Cy",
          provider: "google",
          connection: { accountEmail: "cy@acme.com" },
        },
      ]);
      await expect(MemberMailboxService.list(member)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(async () =>
        MemberMailboxService.memberFor(member, "user_c"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      stubProviders({
        "oauth2.googleapis.com/revoke": () =>
          new Response(null, { status: 200 }),
      });
      await ConnectionService.disconnect(
        MemberMailboxService.memberFor(owner, "user_c"),
        "google",
      );
      expect(
        await database.rows(
          `SELECT organization_id, user_id FROM mailbox_connection`,
        ),
      ).toEqual([{ organization_id: "org_b", user_id: "user_b" }]);
    });

    it("pauses the syncs of members not seen for 30 days, and starts the clock on one never seen", async () => {
      const now = new Date("2026-10-19T05:00:00.000Z");
      await database.exec(
        `UPDATE member SET last_seen_at = '2026-09-01T00:00:00.000Z' WHERE user_id = 'user_a';
         UPDATE member SET last_seen_at = '2026-10-18T09:00:00.000Z' WHERE user_id = 'user_b';`,
      );
      await addCy();
      for (const [member, accountEmail] of [
        [ANA, "ana@acme.com"],
        [BO, "bo@contoso.com"],
        [CY, "cy@acme.com"],
      ] as const) {
        await seedMailbox({
          ...member,
          provider: "google",
          accountEmail,
          sources: ["gmail"],
        });
      }

      expect(await MemberMailboxService.pauseUnseen(now)).toEqual({
        paused: 1,
      });
      expect(
        await database.rows(
          `SELECT user_id, status, next_sync_at FROM mailbox_sync ORDER BY user_id`,
        ),
      ).toMatchObject([
        { user_id: "user_a", status: "PAUSED", next_sync_at: null },
        { user_id: "user_b", status: "IDLE" },
        { user_id: "user_c", status: "IDLE" },
      ]);
      expect(
        await database.rows(
          `SELECT last_seen_at FROM member WHERE user_id = 'user_c'`,
        ),
      ).toEqual([{ last_seen_at: now.toISOString() }]);
    });
  });
}
