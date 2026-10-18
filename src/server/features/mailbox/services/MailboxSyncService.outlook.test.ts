import { beforeEach, describe, expect, it, vi } from "vitest";

// Outlook capture at the minute cron's entry point, on both backends, with
// Microsoft Graph and the gateway faked at the network boundary.
const { testDb, gateway } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  const { createGateway } =
    await import("@/server/features/mailbox/mailboxTestSupport");
  return {
    testDb: await createDualDialectTestDb(),
    gateway: createGateway(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return testDb.modules.workers.env.DATABASE_PROVIDER;
    },
    EVERY_APP_GATEWAY: gateway.binding,
    EVERYAPP_SHARED: "1",
  },
  waitUntil: () => {},
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// The dispatcher's background lane isn't under test (and would ask Autumn).
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { CaptureRepository } from "@/server/features/activities/repositories/CaptureRepository";
import {
  firstValue,
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { MailboxSyncService } from "./MailboxSyncService";

const GRAPH = "graph.microsoft.com/v1.0/me";
const NEXT_PAGE =
  "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=page2";

/** A Graph message, with no internet headers (Graph often leaves them out). */
function message(input: {
  id: string;
  from: string;
  to: string;
  receivedAt: string;
  folder?: string;
}) {
  return {
    id: input.id,
    internetMessageId: `<${input.id}@outlook.com>`,
    conversationId: "conv-1",
    subject: "Renewal",
    from: {
      emailAddress: { name: input.from.split("@")[0], address: input.from },
    },
    toRecipients: [{ emailAddress: { address: input.to } }],
    ccRecipients: [],
    receivedDateTime: input.receivedAt,
    sentDateTime: input.receivedAt,
    body: { contentType: "html", content: `<p>About the renewal</p>` },
    parentFolderId: input.folder ?? "inbox-id",
    webLink: `https://outlook.office365.com/owa/?ItemID=${input.id}`,
  };
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`Outlook capture (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      gateway.tokenCalls.length = 0;
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await seedMailbox({
        organizationId: "org_b",
        userId: "user_b",
        provider: "microsoft",
        accountEmail: "bo@contoso.com",
        sources: ["outlook"],
      });
    });

    const cursor = async () =>
      firstValue(database.rows(`SELECT cursor FROM mailbox_sync`), "cursor");

    it("watches from now on its first check", async () => {
      const fetched = stubProviders({});
      const before = new Date().toISOString();

      await MailboxSyncService.runDue();
      expect(String(await cursor()) >= before).toBe(true);
      expect(fetched).toEqual([]);
    });

    it("files a conversation across pages, skipping junk, by its conversation id", async () => {
      await database.exec(
        `UPDATE mailbox_sync SET cursor = '2026-10-01T00:00:00.000Z', auto_create = ${dialect === "sqlite" ? 1 : "true"}`,
      );
      stubProviders({
        [`${GRAPH}/mailFolders/junkemail`]: () => ({ id: "junk-id" }),
        [`${GRAPH}/mailFolders/deleteditems`]: () =>
          json(
            { error: { code: "ErrorItemNotFound", message: "Not found" } },
            404,
          ),
        [`${GRAPH}/messages`]: (url) =>
          url.searchParams.get("$skiptoken")
            ? {
                value: [
                  message({
                    id: "m2",
                    from: "kim@wayne.com",
                    to: "bo@contoso.com",
                    receivedAt: "2026-10-01T11:00:00Z",
                  }),
                ],
              }
            : {
                value: [
                  message({
                    id: "m1",
                    from: "bo@contoso.com",
                    to: "kim@wayne.com",
                    receivedAt: "2026-10-01T10:00:00Z",
                  }),
                  message({
                    id: "spam",
                    from: "win@prizes.biz",
                    to: "bo@contoso.com",
                    receivedAt: "2026-10-01T10:30:00Z",
                    folder: "junk-id",
                  }),
                ],
                "@odata.nextLink": NEXT_PAGE,
              },
      });

      await MailboxSyncService.runDue();
      expect(await cursor()).toBe("2026-10-01T11:00:00.000Z");
      expect(await database.rows(`SELECT domain FROM company`)).toEqual([
        { domain: "wayne.com" },
      ]);
      const [thread] = await database.rows(
        `SELECT id, root_message_id, message_count FROM email_thread`,
      );
      expect(thread).toMatchObject({
        root_message_id: "outlook-conversation:conv-1",
        message_count: 2,
      });
      const stored = await CaptureRepository.thread(
        "org_b",
        String(
          await firstValue(database.rows(`SELECT id FROM email_thread`), "id"),
        ),
      );
      expect(
        stored?.messages.map((entry) => [entry.body, entry.mailboxName]),
      ).toEqual([
        ["About the renewal", "Outlook"],
        ["About the renewal", "Outlook"],
      ]);
    });

    it("keeps the refresh token Microsoft rotates", async () => {
      await database.exec(
        `UPDATE mailbox_connection SET access_token_expires_at = '2000-01-01T00:00:00.000Z'`,
      );
      gateway.answerTokens(() =>
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        }),
      );
      stubProviders({});

      await MailboxSyncService.runDue();
      expect(gateway.tokenCalls[0]?.path).toBe(
        "/api/integrations/microsoft-365/login.microsoftonline.com/common/oauth2/v2.0/token",
      );
      expect(gateway.tokenCalls[0]?.form.get("refresh_token")).toBe(
        "stored-refresh",
      );
      expect(
        await database.rows(
          `SELECT access_token, refresh_token FROM mailbox_connection`,
        ),
      ).toEqual([{ access_token: "access-2", refresh_token: "refresh-2" }]);
    });
  });
}
