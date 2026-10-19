import { format } from "node:util";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

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
  },
  waitUntil: () => {},
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// The dispatcher's background lane isn't under test.
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { CaptureRepository } from "@/server/features/activities/repositories/CaptureRepository";
import {
  firstValue,
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import { CaptureService } from "./CaptureService";
import { MailboxSyncService } from "./MailboxSyncService";

const GRAPH = "graph.microsoft.com/v1.0/me";

/** A trigger that fails every write of a refresh token. */
const REFUSE_TOKEN_WRITES = {
  sqlite: {
    create: `CREATE TRIGGER refuse_token_write BEFORE UPDATE OF refresh_token ON mailbox_connection BEGIN SELECT RAISE(ABORT, 'refused'); END;`,
    drop: `DROP TRIGGER refuse_token_write;`,
  },
  postgres: {
    create: `CREATE FUNCTION refuse_token_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$;
      CREATE TRIGGER refuse_token_write BEFORE UPDATE OF refresh_token ON mailbox_connection FOR EACH ROW EXECUTE FUNCTION refuse_token_write();`,
    drop: `DROP TRIGGER refuse_token_write ON mailbox_connection; DROP FUNCTION refuse_token_write();`,
  },
};
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

    it("passes over a message that can't be stored once a later one is, and holds its place until then", async () => {
      await database.exec(
        `UPDATE mailbox_sync SET cursor = '2026-10-01T00:00:00.000Z', auto_create = ${dialect === "sqlite" ? 1 : "true"}`,
      );
      const store = CaptureService.storeMessage;
      vi.spyOn(CaptureService, "storeMessage").mockImplementation(
        (job, incoming, context) =>
          incoming.rfcMessageId === "bad@outlook.com"
            ? Promise.reject(new Error("Failed query: params: its body"))
            : store(job, incoming, context),
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const page = (...messages: [string, string][]) =>
        stubProviders({
          [`${GRAPH}/messages`]: () => ({
            value: messages.map(([id, receivedAt]) =>
              message({
                id,
                from: "bo@contoso.com",
                to: "kim@wayne.com",
                receivedAt,
              }),
            ),
          }),
        });
      const state = () =>
        database.rows(`SELECT status, cursor FROM mailbox_sync`);

      // Nothing was stored after it, so the fault may be the database's.
      page(["good", "2026-10-01T10:00:00Z"], ["bad", "2026-10-01T11:00:00Z"]);
      await MailboxSyncService.runDue();
      expect(await state()).toEqual([
        { status: "FAILED", cursor: "2026-10-01T10:00:00.000Z" },
      ]);
      expect(errors).toHaveBeenCalledWith("[mailbox] could not store an item", {
        organizationId: "org_b",
        userId: "user_b",
        source: "outlook",
        id: "bad",
      });

      // A later message is stored: the fault was the message's own.
      page(["bad", "2026-10-01T11:00:00Z"], ["later", "2026-10-01T12:00:00Z"]);
      await database.exec(
        `UPDATE mailbox_sync SET next_sync_at = '2000-01-01T00:00:00.000Z'`,
      );
      await MailboxSyncService.runDue();
      expect(await state()).toEqual([
        { status: "IDLE", cursor: "2026-10-01T12:00:00.000Z" },
      ]);
      expect(
        await database.rows(
          `SELECT rfc_message_id FROM email_message ORDER BY rfc_message_id`,
        ),
      ).toEqual([
        { rfc_message_id: "good@outlook.com" },
        { rfc_message_id: "later@outlook.com" },
      ]);
    });

    it("keeps the refresh token Microsoft rotates, encrypted, from a row stored before tokens were", async () => {
      await database.exec(
        `UPDATE mailbox_connection SET access_token = 'stored-access', refresh_token = 'stored-refresh', access_token_expires_at = '2000-01-01T00:00:00.000Z'`,
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
      const stored = JSON.stringify(
        await database.rows(`SELECT * FROM mailbox_connection`),
      );
      expect(stored).not.toContain("access-2");
      expect(stored).not.toContain("refresh-2");
      expect(
        await ConnectionRepository.findWithTokens(
          "org_b",
          "user_b",
          "microsoft",
        ),
      ).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    });

    it("logs a check that failed to store its tokens without the query or its parameters", async () => {
      await database.exec(
        `UPDATE mailbox_connection SET access_token_expires_at = '2000-01-01T00:00:00.000Z'`,
      );
      gateway.answerTokens(() =>
        json({ access_token: "access-2", refresh_token: "refresh-2" }),
      );
      stubProviders({});
      await database.exec(REFUSE_TOKEN_WRITES[dialect].create);
      onTestFinished(() => database.exec(REFUSE_TOKEN_WRITES[dialect].drop));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      await MailboxSyncService.runDue();
      // The database's own code says what failed.
      const code: unknown = expect.any(String);
      expect(logged).toHaveBeenCalledWith(
        "[mailbox] check failed",
        expect.objectContaining({ source: "outlook", code }),
      );
      const output = logged.mock.calls.map((call) => format(...call)).join();
      expect(output).not.toContain("Failed query");
      expect(output).not.toContain("enc:v1:");
    });
  });
}
