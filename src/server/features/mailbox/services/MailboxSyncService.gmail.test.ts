import { beforeEach, describe, expect, it, vi } from "vitest";

// Gmail capture end to end at the minute cron's entry point, on both
// backends, with Gmail and the gateway faked at the network boundary.
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

import { CaptureRepository } from "@/server/features/activities/repositories/CaptureRepository";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import {
  firstValue,
  gmailMessage,
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { MailboxSyncService } from "./MailboxSyncService";

const GMAIL = "gmail.googleapis.com/gmail/v1/users/me";
const ANA = { organizationId: "org_a", userId: "user_a" };

type History = { id: string; messages: string[] }[];

/** Gmail with `messages` by id and a history of them since any cursor. */
function fakeGmail(input: {
  history?: History;
  messages?: Record<string, unknown>;
  historyId?: string;
}) {
  return stubProviders({
    [`${GMAIL}/profile`]: () => ({
      emailAddress: "ana@acme.com",
      historyId: input.historyId ?? "100",
    }),
    [`${GMAIL}/history`]: () => ({
      history: (input.history ?? []).map((entry) => ({
        id: entry.id,
        messagesAdded: entry.messages.map((id) => ({ message: { id } })),
      })),
      historyId: input.historyId ?? "100",
    }),
    ...Object.fromEntries(
      Object.entries(input.messages ?? {}).map(([id, body]) => [
        `${GMAIL}/messages/${id}`,
        () => body,
      ]),
    ),
  });
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`Gmail capture (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      gateway.tokenCalls.length = 0;
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await seedMailbox({
        ...ANA,
        provider: "google",
        accountEmail: "ana@acme.com",
        sources: ["gmail"],
      });
    });

    const cursor = async () =>
      firstValue(database.rows(`SELECT cursor FROM mailbox_sync`), "cursor");
    const dueAgain = () =>
      database.exec(
        `UPDATE mailbox_sync SET next_sync_at = '2000-01-01T00:00:00.000Z'`,
      );

    it("watches from now on its first check and files nothing it finds", async () => {
      const fetched = fakeGmail({ historyId: "100" });

      expect(await MailboxSyncService.runDue()).toEqual({ checked: 1 });
      expect(await cursor()).toBe("100");
      expect(fetched.map((url) => url.pathname)).toEqual([
        "/gmail/v1/users/me/profile",
      ]);
      // Not due again for five minutes.
      expect(await MailboxSyncService.runDue()).toEqual({ checked: 0 });
    });

    it("adds the company and contact of a conversation the member wrote in, once", async () => {
      await database.exec(
        `UPDATE mailbox_sync SET cursor = '100', auto_create = ${dialect === "sqlite" ? 1 : "true"}`,
      );
      const messages = {
        g1: gmailMessage({
          id: "g1",
          messageId: "root@acme.com",
          from: "Ana <ana@acme.com>",
          to: "Jane Doe <jane@globex.com>",
          cc: "noreply@globex.com, Pat <pat@gmail.com>",
          subject: "Pilot",
          text: "Shall we start the pilot?",
          sentAt: "2026-10-01T09:00:00.000Z",
        }),
        g2: gmailMessage({
          id: "g2",
          messageId: "reply@globex.com",
          from: "Jane Doe <jane@globex.com>",
          to: "ana@acme.com",
          subject: "Re: Pilot",
          text: "Yes, Monday.",
          sentAt: "2026-10-01T10:00:00.000Z",
          references: "<root@acme.com>",
        }),
      };
      fakeGmail({
        historyId: "105",
        history: [
          { id: "101", messages: ["g1"] },
          { id: "102", messages: ["g2"] },
        ],
        messages,
      });

      await MailboxSyncService.runDue();
      expect(await cursor()).toBe("105");
      expect(
        await database.rows(`SELECT name, domain, source FROM company`),
      ).toEqual([
        { name: "globex.com", domain: "globex.com", source: "EMAIL" },
      ]);
      expect(
        await database.rows(
          `SELECT first_name, last_name, email, source FROM contact`,
        ),
      ).toEqual([
        {
          first_name: "Jane",
          last_name: "Doe",
          email: "jane@globex.com",
          source: "EMAIL",
        },
      ]);
      expect(
        await database.rows(
          `SELECT type, subject FROM activity ORDER BY type, subject`,
        ),
      ).toEqual([
        { type: "EMAIL", subject: "Pilot" },
        { type: "ENRICHMENT", subject: "Company added from your inbox" },
        { type: "ENRICHMENT", subject: "Contact added from your inbox" },
      ]);
      const threads = database.rows(
        `SELECT id, message_count FROM email_thread`,
      );
      expect(await firstValue(threads, "message_count")).toBe(2);
      const stored = await CaptureRepository.thread(
        "org_a",
        String(await firstValue(threads, "id")),
      );
      expect(
        stored?.messages.map((message) => ({
          direction: message.direction,
          body: message.body,
          mailboxUrl: message.mailboxUrl,
        })),
      ).toEqual([
        {
          direction: "OUTBOUND",
          body: "Shall we start the pilot?",
          mailboxUrl: "https://mail.google.com/mail/u/0/#all/g1",
        },
        {
          direction: "INBOUND",
          body: "Yes, Monday.",
          mailboxUrl: "https://mail.google.com/mail/u/0/#all/g2",
        },
      ]);

      // The same history read again files nothing twice.
      await database.exec(`UPDATE mailbox_sync SET cursor = '100'`);
      await dueAgain();
      await MailboxSyncService.runDue();
      expect(await database.rows(`SELECT id FROM email_message`)).toHaveLength(
        2,
      );
      expect(await database.rows(`SELECT id FROM activity`)).toHaveLength(3);
    });

    it("files mail from people it knows, and adds no one the member never wrote to", async () => {
      await database.exec(
        `UPDATE mailbox_sync SET cursor = '100', auto_create = ${dialect === "sqlite" ? 1 : "true"}`,
      );
      await ContactRepository.insert({
        organizationId: "org_a",
        firstName: "Sam",
        lastName: null,
        email: "sam@initech.com",
        phone: null,
        title: null,
        companyId: null,
        ownerId: null,
      });
      const inbound = (id: string, from: string) =>
        gmailMessage({
          id,
          messageId: `${id}@mail`,
          from,
          to: "ana@acme.com",
          subject: id,
          text: "Hello",
          sentAt: "2026-10-01T09:00:00.000Z",
        });
      fakeGmail({
        historyId: "103",
        history: [{ id: "101", messages: ["known", "cold", "robot"] }],
        messages: {
          known: inbound("known", "Sam <sam@initech.com>"),
          cold: inbound("cold", "Lee <lee@hooli.com>"),
          robot: inbound("robot", "Billing <billing@hooli.com>"),
        },
      });

      await MailboxSyncService.runDue();
      expect(
        await database.rows(
          `SELECT subject, contact_id IS NOT NULL AS filed FROM email_thread`,
        ),
      ).toEqual([{ subject: "known", filed: dialect === "sqlite" ? 1 : true }]);
      expect(await database.rows(`SELECT id FROM company`)).toEqual([]);
    });

    it("asks the member to reconnect when Google refuses the refresh", async () => {
      await database.exec(
        `UPDATE mailbox_connection SET access_token_expires_at = '2000-01-01T00:00:00.000Z'`,
      );
      gateway.answerTokens(() =>
        json(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          400,
        ),
      );
      fakeGmail({});

      await MailboxSyncService.runDue();
      const [call] = gateway.tokenCalls;
      expect(Object.fromEntries(call?.form ?? [])).toEqual({
        grant_type: "refresh_token",
        refresh_token: "stored-refresh",
      });
      // The cron names the organization the refresh is for.
      expect(call?.headers.get("x-everyapp-org")).toBe("org_a");
      expect(
        await database.rows(`SELECT status, next_sync_at FROM mailbox_sync`),
      ).toEqual([{ status: "NEEDS_RECONNECT", next_sync_at: null }]);
      expect(
        await database.rows(`SELECT status FROM mailbox_connection`),
      ).toEqual([{ status: "NEEDS_RECONNECT" }]);
      await dueAgain();
      expect(await MailboxSyncService.runDue()).toEqual({ checked: 0 });
    });

    it("starts again from now when Gmail no longer keeps the history", async () => {
      await database.exec(`UPDATE mailbox_sync SET cursor = '7'`);
      stubProviders({
        [`${GMAIL}/history`]: () =>
          json({ error: { message: "Requested entity was not found." } }, 404),
      });

      await MailboxSyncService.runDue();
      expect(await cursor()).toBeNull();
    });
  });
}
