import { beforeEach, describe, expect, it, vi } from "vitest";

// Calendar capture at the minute cron's entry point, on both backends, with
// Google Calendar faked at the network boundary.
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

import {
  daysFromNow,
  firstValue,
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { MailboxSyncService } from "./MailboxSyncService";

const EVENTS = "www.googleapis.com/calendar/v3/calendars/primary/events";

/** A Google Calendar event with Ana, a guest and a meeting room. */
function event(input: {
  id: string;
  guest: string;
  startsAt: string;
  status?: string;
  anaResponse?: string;
}) {
  const end = new Date(Date.parse(input.startsAt) + 3600_000).toISOString();
  return {
    id: input.id,
    iCalUID: `${input.id}@google.com`,
    status: input.status ?? "confirmed",
    summary: `Call ${input.id}`,
    location: "Room 4",
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    start: { dateTime: input.startsAt },
    end: { dateTime: end },
    organizer: { email: "ana@acme.com", self: true },
    attendees: [
      {
        email: "ana@acme.com",
        self: true,
        organizer: true,
        responseStatus: input.anaResponse ?? "accepted",
      },
      { email: input.guest, responseStatus: "needsAction" },
      {
        email: "c_1888abc@resource.calendar.google.com",
        displayName: "Room 4",
        resource: true,
        responseStatus: "accepted",
      },
    ],
  };
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`Calendar capture (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await seedMailbox({
        organizationId: "org_a",
        userId: "user_a",
        provider: "google",
        accountEmail: "ana@acme.com",
        sources: ["calendar"],
      });
    });

    const dueAgain = () =>
      database.exec(
        `UPDATE mailbox_sync SET next_sync_at = '2000-01-01T00:00:00.000Z'`,
      );

    it("files the next 180 days' meetings, the people it adds waiting for a person before the agent researches them", async () => {
      const fetched = stubProviders({
        [EVENTS]: () => ({
          items: [
            event({
              id: "soon",
              guest: "lee@umbrella.com",
              startsAt: daysFromNow(2),
            }),
          ],
          nextSyncToken: "sync-1",
        }),
      });

      await MailboxSyncService.runDue();
      const query = fetched[0]?.searchParams;
      expect(query?.get("singleEvents")).toBe("true");
      expect(query?.get("syncToken")).toBeNull();
      const windowDays =
        (Date.parse(query?.get("timeMax") ?? "") -
          Date.parse(query?.get("timeMin") ?? "")) /
        86_400_000;
      expect(Math.round(windowDays)).toBe(180);

      expect(await database.rows(`SELECT domain, source FROM company`)).toEqual(
        [{ domain: "umbrella.com", source: "CALENDAR" }],
      );
      expect(
        await database.rows(
          `SELECT title, conference_url, google_event_id FROM calendar_event`,
        ),
      ).toEqual([
        {
          title: "Call soon",
          conference_url: "https://meet.google.com/abc-defg-hij",
          google_event_id: "soon",
        },
      ]);
      // The room is nobody.
      expect(
        await database.rows(
          `SELECT email FROM calendar_attendee ORDER BY email`,
        ),
      ).toEqual([{ email: "ana@acme.com" }, { email: "lee@umbrella.com" }]);
      expect(
        await database.rows(
          `SELECT type, subject, body FROM activity WHERE type = 'MEETING'`,
        ),
      ).toEqual([
        { type: "MEETING", subject: "Call soon", body: "Location: Room 4" },
      ]);
      // Anyone can send an invite: no identify and no meeting prep until a
      // person opens the contact, but team agents hear of them.
      expect(
        await database.rows(
          `SELECT t.kind FROM agent_task t JOIN contact c ON c.id = t.contact_id ORDER BY t.kind`,
        ),
      ).toEqual([{ kind: "agent-event" }]);
      expect(
        await firstValue(
          database.rows(`SELECT cursor FROM mailbox_sync`),
          "cursor",
        ),
      ).toBe("sync-1");
    });

    it("removes cancelled meetings and adds no one from a meeting the member declined", async () => {
      await database.exec(`UPDATE mailbox_sync SET cursor = 'sync-1'`);
      const gone = event({
        id: "gone",
        guest: "kim@wayne.com",
        startsAt: daysFromNow(31),
      });
      stubProviders({
        [EVENTS]: () => ({
          items: [
            event({
              id: "kept",
              guest: "kim@wayne.com",
              startsAt: daysFromNow(30),
            }),
            gone,
          ],
          nextSyncToken: "sync-2",
        }),
      });
      await MailboxSyncService.runDue();
      expect(await database.rows(`SELECT id FROM calendar_event`)).toHaveLength(
        2,
      );

      stubProviders({
        [EVENTS]: (url) => {
          expect(url.searchParams.get("syncToken")).toBe("sync-2");
          expect(url.searchParams.get("timeMin")).toBeNull();
          return {
            items: [
              { ...gone, status: "cancelled" },
              // A cancelled occurrence Google sends with its id only.
              { id: "kept", status: "cancelled" },
              event({
                id: "declined",
                guest: "max@cyberdyne.com",
                startsAt: daysFromNow(3),
                anaResponse: "declined",
              }),
            ],
            nextSyncToken: "sync-3",
          };
        },
      });
      await dueAgain();
      await MailboxSyncService.runDue();
      expect(await database.rows(`SELECT id FROM calendar_event`)).toEqual([]);
      expect(
        await database.rows(`SELECT type FROM activity WHERE type = 'MEETING'`),
      ).toEqual([]);
      expect(await database.rows(`SELECT domain FROM company`)).toEqual([
        { domain: "wayne.com" },
      ]);
    });

    it("re-reads the window when the sync token has expired", async () => {
      await database.exec(`UPDATE mailbox_sync SET cursor = 'old'`);
      stubProviders({
        [EVENTS]: () =>
          json({ error: { message: "Sync token is no longer valid" } }, 410),
      });

      await MailboxSyncService.runDue();
      expect(
        await database.rows(`SELECT cursor, status FROM mailbox_sync`),
      ).toEqual([{ cursor: null, status: "IDLE" }]);
    });
  });
}
