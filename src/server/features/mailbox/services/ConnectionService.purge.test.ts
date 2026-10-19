import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Deleting what mailboxes brought in: one member's synced
// data, and the threads and meetings of a domain someone suppressed.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import { MeetingWriteRepository } from "@/server/features/mailbox/repositories/MeetingWriteRepository";
import { firstValue } from "@/server/features/mailbox/mailboxTestSupport";
import { ConnectionService } from "./ConnectionService";

const ANA = { organizationId: "org_a", userId: "user_a" };
const NOW = "2026-01-01T00:00:00.000Z";

/** A captured Gmail (or, without a Gmail id, Outlook) message of org_a. */
const message = (
  rfc: string,
  by: string,
  sentAt: string,
  gmail: string | null,
) => ({
  organizationId: "org_a",
  rfcMessageId: rfc,
  syncedByUserId: by,
  direction: "INBOUND" as const,
  fromEmail: "jane@globex.com",
  fromName: null,
  recipients: [],
  subject: rfc,
  snippet: `snippet ${rfc}`,
  body: null,
  sentAt,
  gmailMessageId: gmail,
  outlookMessageId: gmail ? null : `o-${rfc}`,
  outlookWebLink: null,
});

describe("ConnectionService purges", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  it("deletes a member's synced data and rebuilds the threads others' mail keeps", async () => {
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('co1', 'org_a', 'Globex', 'globex.com')`,
    );
    const file = async (
      root: string,
      messages: ReturnType<typeof message>[],
    ) => {
      const threadId = await CaptureWriteRepository.upsertThread({
        organizationId: "org_a",
        rootMessageId: root,
        subject: root,
        companyId: "co1",
        contactId: null,
        sentAt: messages[0]?.sentAt ?? "",
      });
      for (const entry of messages) {
        await CaptureWriteRepository.insertMessage({ ...entry, threadId });
        await CaptureWriteRepository.projectThread({
          organizationId: "org_a",
          threadId,
          userId: entry.syncedByUserId,
          message: entry,
          companyId: "co1",
          contactId: null,
          origin: "gmail",
        });
      }
    };
    // A thread only Ana's Gmail brought in, and one another mailbox
    // (Outlook) shares.
    await file("mine", [
      message("m1", "user_a", "2026-01-01T00:00:00.000Z", "g1"),
    ]);
    await file("shared", [
      message("s1", "user_a", "2026-01-02T00:00:00.000Z", "g2"),
      message("s2", "user_a", "2026-01-03T00:00:00.000Z", null),
    ]);
    await MeetingWriteRepository.upsertEvent({
      organizationId: "org_a",
      iCalUid: "ical-1",
      originalStartTime: "2026-02-01T00:00:00.000Z",
      recurringEventId: null,
      title: "Kickoff",
      description: null,
      location: null,
      conferenceUrl: null,
      startsAt: "2026-02-01T00:00:00.000Z",
      endsAt: "2026-02-01T01:00:00.000Z",
      isAllDay: false,
      status: "confirmed",
      organizerEmail: null,
      companyId: "co1",
      contactId: null,
      syncedByUserId: "user_a",
      googleEventId: "ev1",
    });

    expect(await ConnectionService.purgeSynced(ANA, "google")).toEqual({
      purged: 3,
    });
    expect(
      await database.rows(
        `SELECT root_message_id, message_count, subject FROM email_thread`,
      ),
    ).toEqual([{ root_message_id: "shared", message_count: 1, subject: "s2" }]);
    expect(
      await database.rows(
        `SELECT type, body, occurred_at FROM activity ORDER BY type`,
      ),
    ).toEqual([
      {
        type: "EMAIL",
        body: "snippet s2",
        occurred_at: "2026-01-03T00:00:00.000Z",
      },
    ]);
    expect(await database.rows(`SELECT id FROM calendar_event`)).toEqual([]);
    expect(
      await firstValue(
        database.rows(`SELECT last_activity_at FROM company`),
        "last_activity_at",
      ),
    ).toBe(
      await firstValue(
        database.rows(`SELECT created_at FROM activity`),
        "created_at",
      ),
    );
  });

  it("suppresses a domain without deleting what was filed, and never one of our own", async () => {
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('co1', 'org_a', 'Globex', 'globex.com');
         INSERT INTO email_thread (id, organization_id, root_message_id, company_id, first_message_at, last_message_at) VALUES ('t1', 'org_a', 'r1', 'co1', '${NOW}', '${NOW}');`,
    );
    // Ana, a member, signs in at a.test.
    await expect(
      ConnectionService.suppressDomain("org_a", {
        domain: "a.test",
        purge: false,
      }),
    ).rejects.toThrow("That is our own domain — it is already excluded.");

    expect(
      await ConnectionService.suppressDomain("org_a", {
        domain: "https://www.Globex.com/about",
        reason: "A supplier",
        purge: false,
      }),
    ).toEqual({ domain: "globex.com", purged: 0 });
    expect(
      await database.rows(
        `SELECT organization_id, domain, reason FROM suppressed_domain`,
      ),
    ).toEqual([
      {
        organization_id: "org_a",
        domain: "globex.com",
        reason: "A supplier",
      },
    ]);
    expect(await database.rows(`SELECT id FROM email_thread`)).toEqual([
      { id: "t1" },
    ]);
  });

  it("with purge, deletes the threads and meetings filed on the domain's company", async () => {
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain, last_activity_at) VALUES
           ('co1', 'org_a', 'Globex', 'globex.com', '${NOW}'),
           ('co2', 'org_a', 'Initech', 'initech.com', NULL),
           ('co3', 'org_b', 'Globex', 'globex.com', NULL);
         INSERT INTO email_thread (id, organization_id, root_message_id, company_id, first_message_at, last_message_at) VALUES
           ('t1', 'org_a', 'r1', 'co1', '${NOW}', '${NOW}'),
           ('t2', 'org_a', 'r2', 'co2', '${NOW}', '${NOW}'),
           ('t3', 'org_b', 'r3', 'co3', '${NOW}', '${NOW}');
         INSERT INTO activity (id, organization_id, type, company_id, email_thread_id) VALUES ('a1', 'org_a', 'EMAIL', 'co1', 't1');
         INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, starts_at, ends_at, status, company_id) VALUES
           ('e1', 'org_a', 'i1', '${NOW}', '${NOW}', '${NOW}', 'confirmed', 'co1');`,
    );

    expect(
      await ConnectionService.suppressDomain("org_a", {
        domain: "globex.com",
        purge: true,
      }),
    ).toEqual({ domain: "globex.com", purged: 2 });
    expect(
      await database.rows(`SELECT id FROM email_thread ORDER BY id`),
    ).toEqual([{ id: "t2" }, { id: "t3" }]);
    expect(await database.rows(`SELECT id FROM calendar_event`)).toEqual([]);
    expect(await database.rows(`SELECT id FROM activity`)).toEqual([]);
    expect(
      await firstValue(
        database.rows(`SELECT last_activity_at FROM company WHERE id = 'co1'`),
        "last_activity_at",
      ),
    ).toBeNull();
  });
});
