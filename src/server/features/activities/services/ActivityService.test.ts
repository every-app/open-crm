import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The timeline: last-activity stamps are conditional
// updates in a batch, the views and counts are SQL conditions, and entries
// carry JSON and boolean columns.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { db } from "@/db";
import { member, user } from "@/db/schema";
import { createActivitySchema } from "@/types/schemas/activities";
import { ActivityService } from "./ActivityService";

const A = "org_a";
const B = "org_b";
const acme = { kind: "company", id: "acme" } as const;

const stampRow = z.object({
  id: z.string(),
  last_activity_at: z.string().nullable(),
});

const log = (
  input: z.input<typeof createActivitySchema>,
  organizationId = A,
  userId = "user_a",
) =>
  ActivityService.createActivity(
    organizationId,
    userId,
    createActivitySchema.parse(input),
  );

describe("ActivityService", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme');
        INSERT INTO contact (id, organization_id, first_name, last_name, email, image_url, company_id)
          VALUES ('ana', 'org_a', 'Ana', 'Zed', 'ana@acme.com', 'https://img.test/ana.png', 'acme');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'acme', 'user_a');
      `);
  });

  /** Each record's last activity, by id. */
  const stamps = async () =>
    Object.fromEntries(
      (
        await database.rows(`
            SELECT id, last_activity_at FROM company UNION ALL
            SELECT id, last_activity_at FROM contact UNION ALL
            SELECT id, last_activity_at FROM deal`)
      ).map((row) => {
        const { id, last_activity_at } = stampRow.parse(row);
        return [id, last_activity_at];
      }),
    );

  it("files an activity under its record's company and moves last activity up, never back", async () => {
    const note = await log({
      type: "NOTE",
      body: "Wants SSO",
      contactId: "ana",
    });
    expect(note).toMatchObject({
      type: "NOTE",
      body: "Wants SSO",
      company: { id: "acme", name: "Acme" },
      contact: { id: "ana", firstName: "Ana" },
      deal: null,
      createdBy: { id: "user_a", name: "Ana" },
    });
    expect(await stamps()).toEqual({
      acme: note.createdAt,
      ana: note.createdAt,
      renewal: null,
    });

    await database.exec(
      `UPDATE deal SET last_activity_at = '2999-01-01T00:00:00.000Z'`,
    );
    const call = await log({
      type: "CALL",
      body: "Pricing",
      dealId: "renewal",
      occurredAt: "2026-01-02T10:00:00Z",
    });
    expect(call).toMatchObject({
      company: { id: "acme" },
      deal: { id: "renewal" },
      occurredAt: "2026-01-02T10:00:00.000Z",
    });
    expect(await stamps()).toEqual({
      acme: call.createdAt,
      ana: note.createdAt,
      renewal: "2999-01-01T00:00:00.000Z",
    });
  });

  it("pages a timeline newest first, keeps open tasks apart and counts each view", async () => {
    await log({
      type: "NOTE",
      body: "Met at the conference",
      contactId: "ana",
      occurredAt: "2026-10-01T09:00:00Z",
    });
    await log({
      type: "CALL",
      body: "Discovery",
      companyId: "acme",
      occurredAt: "2026-10-03T09:00:00Z",
    });
    await log({
      type: "TASK",
      subject: "Send the contract",
      companyId: "acme",
      dueAt: "2026-10-20T17:00:00Z",
      occurredAt: "2026-10-06T09:00:00Z",
    });
    const demo = await log({
      type: "TASK",
      subject: "Book a demo",
      companyId: "acme",
      occurredAt: "2026-10-05T09:00:00Z",
    });
    await ActivityService.completeTask(A, demo.id, true);
    // What the deals and the agent write: a stage change, and a finding
    // that says only when it was written.
    await database.exec(`
        INSERT INTO activity (id, organization_id, type, company_id, deal_id, created_by_id, meta, occurred_at)
          VALUES ('stage', 'org_a', 'STAGE_CHANGE', 'acme', 'renewal', 'user_a', '{"from":"DEMO_BOOKED","to":"CONTRACT_SENT"}', '2026-10-02T09:00:00.000Z');
        INSERT INTO activity (id, organization_id, type, subject, company_id, created_at)
          VALUES ('found', 'org_a', 'ENRICHMENT', 'Found the logo', 'acme', '2026-10-04T09:00:00.000Z');
      `);

    const page = (cursor?: string) =>
      ActivityService.timeline(A, {
        record: acme,
        filter: "history",
        cursor,
        limit: 2,
      });
    const first = await page();
    const second = await page(first.nextCursor ?? undefined);
    const third = await page(second.nextCursor ?? undefined);
    expect(
      [first, second, third].map(({ entries }) =>
        entries.map((entry) => entry.subject ?? entry.body ?? entry.type),
      ),
    ).toEqual([
      ["Book a demo", "Found the logo"],
      ["Discovery", "STAGE_CHANGE"],
      ["Met at the conference"],
    ]);
    expect(third.nextCursor).toBeNull();
    expect(first.entries[1]).toMatchObject({ createdBy: null });
    expect(second.entries[1]).toMatchObject({
      meta: { from: "DEMO_BOOKED", to: "CONTRACT_SENT" },
      deal: { id: "renewal", name: "Renewal" },
    });

    const upcoming = await ActivityService.timeline(A, {
      record: acme,
      filter: "upcoming",
      limit: 30,
    });
    expect(upcoming.entries).toMatchObject([
      { subject: "Send the contract", dueAt: "2026-10-20T17:00:00.000Z" },
    ]);
    expect(await ActivityService.timelineCounts(A, acme)).toEqual({
      all: 6,
      notes: 2,
      upcoming: 1,
      done: 1,
      email: 0,
      meetings: 0,
    });
    const ofAna = await ActivityService.timeline(A, {
      record: { kind: "contact", id: "ana" },
      filter: "all",
      limit: 30,
    });
    expect(ofAna.entries.map((entry) => entry.body)).toEqual([
      "Met at the conference",
    ]);
  });

  it("lists the open tasks I set, soonest due first, until they're ticked off", async () => {
    await db
      .insert(user)
      .values({ id: "user_c", name: "Cy", email: "cy@a.test" });
    await db.insert(member).values({
      id: "m_c",
      organizationId: A,
      userId: "user_c",
      role: "member",
      createdAt: new Date(0),
    });
    const task = (subject: string, dueAt: string | null, userId = "user_a") =>
      log({ type: "TASK", subject, dueAt, companyId: "acme" }, A, userId);
    const overdue = await task("Chase the invoice", "2000-01-01T00:00:00Z");
    await task("Renewal call", "2999-01-01T00:00:00Z");
    await task("Someday", null);
    await task("Cy's own", "2000-01-01T00:00:00Z", "user_c");
    const note = await log({ type: "NOTE", body: "Hi", companyId: "acme" });

    const mine = async (window: "all" | "overdue" | "upcoming") =>
      (await ActivityService.myTasks(A, "user_a", { window, limit: 25 })).map(
        (entry) => entry.subject,
      );
    expect(await mine("all")).toEqual([
      "Chase the invoice",
      "Renewal call",
      "Someday",
    ]);
    expect(await mine("overdue")).toEqual(["Chase the invoice"]);
    expect(await mine("upcoming")).toEqual(["Renewal call"]);

    await expect(
      ActivityService.completeTask(A, note.id, true),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const done = await ActivityService.completeTask(A, overdue.id, true);
    expect(done.completedAt).not.toBeNull();
    expect(await mine("all")).toEqual(["Renewal call", "Someday"]);
    await ActivityService.completeTask(A, overdue.id, false);
    expect(await mine("overdue")).toEqual(["Chase the invoice"]);
  });

  it("shows captured mail and meetings with their messages and attendees", async () => {
    await database.exec(`
        INSERT INTO email_thread (id, organization_id, root_message_id, subject, company_id, first_message_at, last_message_at, message_count)
          VALUES ('t1', 'org_a', '<root@acme.com>', 'Pricing', 'acme', '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z', 2);
        INSERT INTO email_message (id, organization_id, thread_id, rfc_message_id, direction, from_email, from_name, recipients, body, sent_at) VALUES
          ('m2', 'org_a', 't1', '<2@acme.com>', 'OUTBOUND', 'ana@a.test', 'Ana', '[{"email":"ana@acme.com","name":null}]', 'Here it is', '2026-10-02T09:00:00.000Z'),
          ('m1', 'org_a', 't1', '<1@acme.com>', 'INBOUND', 'ana@acme.com', 'Ana Zed', '[{"email":"ana@a.test","name":"Ana","kind":"cc"}, 42]', 'Send pricing?', '2026-10-01T09:00:00.000Z');
        INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, title, starts_at, ends_at, status, company_id)
          VALUES ('e1', 'org_a', 'uid-1', '2026-10-05T15:00:00.000Z', 'Demo', '2026-10-05T15:00:00.000Z', '2026-10-05T16:00:00.000Z', 'confirmed', 'acme');
        INSERT INTO calendar_attendee (id, organization_id, event_id, email, name, is_organizer, contact_id) VALUES
          ('a2', 'org_a', 'e1', 'zoe@acme.com', 'Zoe', false, NULL),
          ('a1', 'org_a', 'e1', 'ana@acme.com', 'Ana Zed', true, 'ana');
        INSERT INTO activity (id, organization_id, type, subject, company_id, email_thread_id, occurred_at, meta)
          VALUES ('mail', 'org_a', 'EMAIL', 'Pricing', 'acme', 't1', '2026-10-02T09:00:00.000Z', '{"synced":true}');
        INSERT INTO activity (id, organization_id, type, subject, company_id, calendar_event_id, occurred_at)
          VALUES ('demo', 'org_a', 'MEETING', 'Demo', 'acme', 'e1', '2026-10-05T15:00:00.000Z');
      `);

    const view = async (filter: "email" | "meetings") =>
      (await ActivityService.timeline(A, { record: acme, filter, limit: 30 }))
        .entries;
    expect(await view("email")).toMatchObject([
      {
        meta: { synced: true },
        emailThread: { id: "t1", messageCount: 2 },
        calendarEvent: null,
      },
    ]);
    expect(await view("meetings")).toMatchObject([
      { calendarEvent: { id: "e1", isAllDay: false, attendeeCount: 2 } },
    ]);

    const thread = await ActivityService.emailThread(A, "t1");
    expect(thread.messages).toMatchObject([
      {
        id: "m1",
        fromImageUrl: "https://img.test/ana.png",
        recipients: [{ email: "ana@a.test", name: "Ana", kind: "cc" }],
      },
      {
        id: "m2",
        fromImageUrl: null,
        recipients: [{ email: "ana@acme.com", name: null, kind: "to" }],
      },
    ]);
    const meeting = await ActivityService.meeting(A, "e1");
    expect(meeting.attendees).toMatchObject([
      {
        email: "ana@acme.com",
        isOrganizer: true,
        imageUrl: "https://img.test/ana.png",
      },
      { email: "zoe@acme.com", isOrganizer: false, imageUrl: null },
    ]);
  });

  it("keeps every activity of one organization out of another's reach", async () => {
    const task = await log({
      type: "TASK",
      subject: "Send the contract",
      dueAt: "2000-01-01T00:00:00Z",
      companyId: "acme",
    });
    await database.exec(`
        INSERT INTO email_thread (id, organization_id, root_message_id, first_message_at, last_message_at)
          VALUES ('t1', 'org_a', '<root@acme.com>', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');
        INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, starts_at, ends_at, status)
          VALUES ('e1', 'org_a', 'uid-1', '2026-10-05T15:00:00.000Z', '2026-10-05T15:00:00.000Z', '2026-10-05T16:00:00.000Z', 'confirmed');
      `);
    const before = await stamps();

    for (const attempt of [
      ActivityService.timeline(B, { record: acme, filter: "all", limit: 30 }),
      ActivityService.timelineCounts(B, acme),
      log({ type: "NOTE", body: "Mine now", companyId: "acme" }, B, "user_b"),
      log({ type: "NOTE", body: "Mine now", dealId: "renewal" }, B, "user_b"),
      ActivityService.completeTask(B, task.id, true),
      ActivityService.emailThread(B, "t1"),
      ActivityService.meeting(B, "e1"),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(
      await ActivityService.myTasks(B, "user_a", {
        window: "all",
        limit: 25,
      }),
    ).toEqual([]);
    expect(await stamps()).toEqual(before);
    expect(
      (
        await ActivityService.myTasks(A, "user_a", {
          window: "all",
          limit: 25,
        })
      ).map((entry) => entry.completedAt),
    ).toEqual([null]);
  });
});
