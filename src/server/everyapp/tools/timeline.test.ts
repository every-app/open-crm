import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The timeline, captured mail and Home's summary as AI clients reach them:
// through the SDK's tools endpoint, on real SQL.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);

import {
  READ_WRITE,
  ana,
  bo,
  call,
  failure,
  idFrom,
  type Caller,
} from "@/server/everyapp/toolTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";

const member: Caller = {
  sub: "user_c",
  email: "cy@a.test",
  orgId: "org_a",
  orgRole: "member",
};

// A destructive tool's handler, as a gateway that minted the scope would
// call it: none does yet, so this reaches only the handler's own rules.
const destructive = { scopes: [...READ_WRITE, "mcp:destructive"] };

const timeline = z.object({
  activities: z.array(
    z.object({
      id: z.string(),
      email: z.object({ threadId: z.string() }).nullable(),
      meeting: z.object({ meetingId: z.string() }).nullable(),
    }),
  ),
});

describe("timeline tools", () => {
  let companyId: string;
  beforeAll(async () => {
    await testDb.seedTwoOrganizations();
    companyId = await idFrom("create_company", { name: "Acme" });
  });

  it("activities: logged, changed and deleted by their author, an owner or an admin, and never another organization", async () => {
    const note = await idFrom(
      "log_activity",
      { type: "NOTE", body: "Wants a pilot", companyId },
      { as: member },
    );
    await call("update_activity", { id: note, body: "Wants a pilot in May" });
    const task = await idFrom("log_activity", {
      type: "TASK",
      subject: "Send the pilot terms",
      companyId,
    });
    expect(
      await failure("update_activity", { id: task, body: "x" }, { as: member }),
    ).toBe(
      "Only the person who logged it, an owner or an admin can change or delete it.",
    );
    expect(await failure("update_activity", { id: task, subject: "" })).toBe(
      "A task needs a subject: it is the thing to do.",
    );
    expect(
      await failure(
        "delete_activity",
        { id: note },
        { ...destructive, as: bo },
      ),
    ).toBe(`No activity with id ${note}.`);

    await call("delete_activity", { id: task }, destructive);
    expect(
      await call("list_activities", { kind: "company", id: companyId }),
    ).toMatchObject({
      activities: [{ id: note, body: "Wants a pilot in May" }],
      nextCursor: null,
    });
  });

  it("a timeline's views: their counts, history without the open tasks, and a page size", async () => {
    const contactId = await idFrom("create_contact", {
      firstName: "Jo",
      companyId,
    });
    const record = { kind: "contact", id: contactId };
    const note = await idFrom("log_activity", {
      type: "NOTE",
      body: "Wants a pilot",
      contactId,
    });
    await idFrom("log_activity", {
      type: "TASK",
      subject: "Send the terms",
      contactId,
    });
    expect(
      await call("get_timeline_counts", record, { scopes: ["mcp:read"] }),
    ).toEqual({
      all: 2,
      notes: 1,
      calls: 0,
      "open-tasks": 1,
      "completed-tasks": 0,
      email: 0,
      meetings: 0,
    });
    expect(
      await call("list_activities", { ...record, filter: "history" }),
    ).toMatchObject({ activities: [{ id: note }] });
    const first = await call("list_activities", { ...record, limit: 1 });
    const aCursor: unknown = expect.any(String);
    expect(first).toMatchObject({ nextCursor: aCursor });
    expect(
      await call("list_activities", {
        ...record,
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).toMatchObject({ nextCursor: null });
    expect(await failure("get_timeline_counts", record, { as: bo })).toBe(
      `No contact with id ${contactId}.`,
    );
  });

  it("captured mail: a timeline's thread and meeting ids open their messages, invite and attendees and the records they're filed on, and can't be edited", async () => {
    const at = "2026-10-01T10:00:00.000Z";
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      lastName: "Park",
      companyId,
    });
    const filedOn = {
      company: { id: companyId, name: "Acme" },
      contact: { id: jo, name: "Jo Park" },
    };
    await testDb.exec(`
      INSERT INTO email_thread (id, organization_id, root_message_id, subject, company_id, contact_id, first_message_at, last_message_at, message_count) VALUES ('thr_1', 'org_a', '<root@acme.test>', 'Pilot terms', '${companyId}', '${jo}', '${at}', '${at}', 1);
      INSERT INTO email_message (id, organization_id, thread_id, rfc_message_id, direction, from_email, from_name, recipients, subject, snippet, body, sent_at) VALUES ('msg_1', 'org_a', 'thr_1', '<root@acme.test>', 'INBOUND', 'jo@acme.test', 'Jo', '[{"email":"ana@a.test","name":"Ana","kind":"to"}]', 'Pilot terms', 'Looks good', 'Looks good to us.', '${at}');
      INSERT INTO activity (id, organization_id, type, subject, body, occurred_at, company_id, created_by_id, email_thread_id) VALUES ('act_mail', 'org_a', 'EMAIL', 'Pilot terms', 'Looks good', '${at}', '${companyId}', 'user_a', 'thr_1');
      INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, title, description, starts_at, ends_at, status, organizer_email, company_id, contact_id) VALUES ('evt_1', 'org_a', 'uid-1', '${at}', 'Pilot kickoff', 'Agenda: the pilot terms', '${at}', '2026-10-01T11:00:00.000Z', 'confirmed', 'jo@acme.test', '${companyId}', '${jo}');
      INSERT INTO calendar_attendee (id, organization_id, event_id, email, name, response_status, is_organizer) VALUES ('att_1', 'org_a', 'evt_1', 'jo@acme.test', 'Jo', 'accepted', 1);
      INSERT INTO activity (id, organization_id, type, subject, occurred_at, company_id, created_by_id, calendar_event_id) VALUES ('act_meet', 'org_a', 'MEETING', 'Pilot kickoff', '${at}', '${companyId}', 'user_a', 'evt_1');
    `);
    const [mail] = timeline.parse(
      await call("list_activities", {
        kind: "company",
        id: companyId,
        filter: "email",
      }),
    ).activities;
    expect(
      await call("get_email_thread", { threadId: mail?.email?.threadId }),
    ).toEqual({
      id: "thr_1",
      subject: "Pilot terms",
      ...filedOn,
      messageCount: 1,
      messages: [
        {
          direction: "INBOUND",
          from: { email: "jo@acme.test", name: "Jo" },
          to: [{ email: "ana@a.test", name: "Ana", kind: "to" }],
          sentAt: at,
          text: "Looks good to us.",
        },
      ],
    });
    const [meeting] = timeline.parse(
      await call("list_activities", {
        kind: "company",
        id: companyId,
        filter: "meetings",
      }),
    ).activities;
    expect(
      await call("get_meeting", { meetingId: meeting?.meeting?.meetingId }),
    ).toMatchObject({
      title: "Pilot kickoff",
      description: "Agenda: the pilot terms",
      organizerEmail: "jo@acme.test",
      ...filedOn,
      attendees: [
        { email: "jo@acme.test", response: "accepted", organizer: true },
      ],
    });
    expect(
      await failure("get_email_thread", { threadId: "thr_1" }, { as: bo }),
    ).toBe("No email thread with id thr_1.");
    expect(
      await failure("get_meeting", { meetingId: "evt_1" }, { as: bo }),
    ).toBe("No meeting with id evt_1.");
    expect(
      await failure("update_activity", { id: "act_mail", body: "x" }),
    ).toBe(
      "Only notes, calls, emails, meetings and tasks a person logged can be changed or deleted.",
    );
  });

  it("suppress_domain stops a domain's people becoming contacts, and the caller's mailbox status needs no connection", async () => {
    expect(
      await call("suppress_domain", { domain: "https://www.spam.test/x" }),
    ).toEqual({ domain: "spam.test" });
    expect(
      await testDb.rows(
        `SELECT organization_id, domain FROM suppressed_domain`,
      ),
    ).toEqual([{ organization_id: "org_a", domain: "spam.test" }]);
    expect(await call("get_mailbox_status")).toEqual({
      providers: [
        { provider: "google", available: false, connection: null },
        { provider: "microsoft", available: false, connection: null },
      ],
    });
  });

  it("the caller's mailbox: Check now queues its sources for the next sweep, and auto-create turns on per source", async () => {
    await seedMailbox({
      organizationId: "org_a",
      userId: "user_a",
      provider: "google",
      accountEmail: ana.email,
      sources: ["gmail", "calendar"],
    });
    const later = new Date(Date.now() + 5 * 60_000).toISOString();
    await testDb.exec(`UPDATE mailbox_sync SET next_sync_at = '${later}'`);
    expect(await failure("check_mailbox_now", { provider: "microsoft" })).toBe(
      "Microsoft isn't connected, or needs reconnecting in Settings → Connections.",
    );
    expect(await call("check_mailbox_now", { provider: "google" })).toEqual({
      sources: ["calendar", "gmail"],
    });
    expect(
      await testDb.rows(
        `SELECT source FROM mailbox_sync WHERE next_sync_at <= '${new Date().toISOString()}' ORDER BY source`,
      ),
    ).toEqual([{ source: "calendar" }, { source: "gmail" }]);
    // A source waiting for a reconnect stays waiting.
    await testDb.exec(
      `UPDATE mailbox_sync SET status = 'NEEDS_RECONNECT', next_sync_at = NULL WHERE source = 'gmail'`,
    );
    expect(await call("check_mailbox_now", { provider: "google" })).toEqual({
      sources: ["calendar"],
    });

    expect(
      await call("set_mailbox_auto_create", { source: "gmail", enabled: true }),
    ).toEqual({ source: "gmail", autoCreate: true });
    expect(await call("get_mailbox_status")).toMatchObject({
      providers: [
        {
          provider: "google",
          connection: {
            accountEmail: ana.email,
            sources: [
              { source: "calendar", autoCreate: true },
              { source: "gmail", autoCreate: true },
            ],
          },
        },
        { provider: "microsoft", connection: null },
      ],
    });
    expect(
      await failure(
        "set_mailbox_auto_create",
        { source: "gmail", enabled: false },
        { as: bo },
      ),
    ).toBe("gmail isn't connected.");
  });

  it("get_sales_summary reports the pipeline in the reporting currency", async () => {
    await call("create_deal", {
      name: "Acme pilot",
      companyId,
      amount: 5000,
      currency: "USD",
    });
    expect(
      await call("get_sales_summary", { scope: "everyone" }),
    ).toMatchObject({
      scope: "everyone",
      reportingCurrency: "USD",
      pipeline: { total: 5000, count: 1 },
      biggestOpen: [{ name: "Acme pilot", company: { id: companyId } }],
    });
  });
});
