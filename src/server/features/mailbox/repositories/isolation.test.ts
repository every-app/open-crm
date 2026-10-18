import { beforeEach, describe, expect, it, vi } from "vitest";

// The mailbox repositories on both backends: what org_a stores never shows
// up for org_b, and a sync row's lease has one holder.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { CaptureWriteRepository } from "./CaptureWriteRepository";
import { ConnectionRepository } from "./ConnectionRepository";
import { MeetingWriteRepository } from "./MeetingWriteRepository";
import { SyncedDataRepository } from "./SyncedDataRepository";
import { SyncStateRepository } from "./SyncStateRepository";

const A = { organizationId: "org_a", userId: "user_a" };

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`mailbox repositories (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("keeps one organization's mailboxes, states and captures from another", async () => {
      await ConnectionRepository.upsert({
        ...A,
        provider: "google",
        accountEmail: "ana@acme.com",
        scopes: "x",
        accessToken: "a",
        accessTokenExpiresAt: new Date().toISOString(),
        refreshToken: "r",
      });
      const state = await ConnectionRepository.createState({
        ...A,
        provider: "google",
        codeVerifier: "v",
        ttlMs: 60_000,
      });
      await SyncStateRepository.ensureSources({
        ...A,
        sources: ["gmail"],
        resetCursor: false,
      });
      const [row] = await SyncStateRepository.listForUser("org_a", "user_a");
      const threadId = await CaptureWriteRepository.upsertThread({
        organizationId: "org_a",
        rootMessageId: "root",
        subject: "Hi",
        companyId: null,
        contactId: null,
        sentAt: "2026-01-01T00:00:00.000Z",
      });
      await CaptureWriteRepository.insertMessage({
        organizationId: "org_a",
        threadId,
        rfcMessageId: "root",
        syncedByUserId: "user_a",
        direction: "INBOUND",
        fromEmail: "jane@globex.com",
        fromName: null,
        recipients: [],
        subject: "Hi",
        snippet: null,
        body: null,
        sentAt: "2026-01-01T00:00:00.000Z",
        gmailMessageId: "g1",
        outlookMessageId: null,
        outlookWebLink: null,
      });
      const event = {
        iCalUid: "ical",
        originalStartTime: "2026-01-01T00:00:00.000Z",
      };
      await MeetingWriteRepository.upsertEvent({
        organizationId: "org_a",
        ...event,
        recurringEventId: null,
        title: null,
        description: null,
        location: null,
        conferenceUrl: null,
        startsAt: event.originalStartTime,
        endsAt: event.originalStartTime,
        isAllDay: false,
        status: "confirmed",
        organizerEmail: null,
        companyId: null,
        contactId: null,
        syncedByUserId: "user_a",
        googleEventId: "e1",
      });

      const asB = { organizationId: "org_b", userId: "user_a" };
      expect(await ConnectionRepository.listForUser("org_b", "user_a")).toEqual(
        [],
      );
      expect(
        await ConnectionRepository.consumeState({
          ...asB,
          provider: "google",
          state,
        }),
      ).toBeNull();
      expect(await ConnectionRepository.accountEmails("org_b")).toEqual([]);
      expect(
        await SyncStateRepository.claim({
          organizationId: "org_b",
          id: row?.id ?? "",
        }),
      ).toBeNull();
      expect(
        await SyncStateRepository.setAutoCreate({
          ...asB,
          source: "gmail",
          enabled: true,
        }),
      ).toBe(false);
      expect(
        await CaptureWriteRepository.threadByRoot("org_b", "root"),
      ).toBeNull();
      expect(
        await CaptureWriteRepository.messageByRfc("org_b", "root"),
      ).toBeNull();
      expect(
        await CaptureWriteRepository.storedGmailIds("org_b", ["g1"]),
      ).toEqual(new Set());
      expect(
        await MeetingWriteRepository.deleteEvent(
          "org_b",
          event.iCalUid,
          event.originalStartTime,
        ),
      ).toBe(false);
      expect(
        await SyncedDataRepository.purgeSynced("org_b", "user_a", "google"),
      ).toMatchObject({
        purged: 0,
      });

      // org_a still has everything, and its own state is good once.
      expect(await database.rows(`SELECT id FROM email_message`)).toHaveLength(
        1,
      );
      expect(await database.rows(`SELECT id FROM calendar_event`)).toHaveLength(
        1,
      );
      expect(
        await ConnectionRepository.consumeState({
          ...A,
          provider: "google",
          state,
        }),
      ).toEqual({ codeVerifier: "v" });
      expect(
        await ConnectionRepository.consumeState({
          ...A,
          provider: "google",
          state,
        }),
      ).toBeNull();
    });

    it("lets one check at a time hold a row, and leaves a held row out of the due list", async () => {
      await SyncStateRepository.ensureSources({
        ...A,
        sources: ["gmail", "calendar"],
        resetCursor: false,
      });
      const due = () =>
        SyncStateRepository.due({
          now: new Date().toISOString(),
          sources: ["gmail", "calendar"],
          limit: 10,
        });
      const [first] = await due();
      const claim = () =>
        SyncStateRepository.claim({
          organizationId: "org_a",
          id: first?.id ?? "",
        });

      expect((await due()).length).toBe(2);
      expect((await claim())?.status).toBe("RUNNING");
      expect(await claim()).toBeNull();
      expect(
        await SyncStateRepository.claim({
          organizationId: "org_a",
          id: first?.id ?? "",
          force: true,
        }),
      ).toBeNull();
      expect((await due()).map((row) => row.id)).not.toContain(first?.id);

      await SyncStateRepository.settle("org_a", first?.id ?? "", {
        status: "IDLE",
        cursor: "42",
      });
      // Settled, it is due in five minutes, and "Check now" may take it.
      expect((await due()).map((row) => row.id)).not.toContain(first?.id);
      // An AI client's "Check now" makes it due for the next sweep instead,
      // in its own organization only.
      const source = first?.source ?? "gmail";
      expect(
        await SyncStateRepository.markDue("org_b", "user_a", [source]),
      ).toEqual([]);
      expect(
        await SyncStateRepository.markDue("org_a", "user_a", [source]),
      ).toEqual([source]);
      expect((await due()).map((row) => row.id)).toContain(first?.id);
      expect(
        (
          await SyncStateRepository.claim({
            organizationId: "org_a",
            id: first?.id ?? "",
            force: true,
          })
        )?.cursor,
      ).toBe("42");
    });
  });
}
