import { beforeEach, describe, expect, it, vi } from "vitest";

// An owner's full export: every dataset of their organization, in cells a
// spreadsheet reads, and nothing of another's.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import type { ExportDataset } from "@/types/schemas/exports";
import { ExportService } from "./ExportService";

const OWNER = { organizationId: "org_a", role: "owner" };

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ExportService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    /** The dataset as rows keyed by header. */
    const exported = async (dataset: ExportDataset) => {
      const { header, rows, next } = await ExportService.page(
        OWNER,
        dataset,
        null,
      );
      expect(next).toBeNull();
      return rows.map((row) =>
        Object.fromEntries(header.map((name, index) => [name, row[index]])),
      );
    };

    it("exports the organization's records with their custom fields, as the import reads them", async () => {
      await database.exec(`
        INSERT INTO company (id, organization_id, name, domain, owner_id) VALUES
          ('co_a', 'org_a', 'Acme', 'acme.test', 'user_a'),
          ('co_b', 'org_b', 'Other', 'other.test', NULL);
        INSERT INTO field_definition (id, organization_id, entity, key, label, type, position) VALUES
          ('f_tier', 'org_a', 'COMPANY', 'tier', 'Tier', 'SELECT', 0);
        INSERT INTO field_option (id, organization_id, field_id, label, position) VALUES
          ('o_gold', 'org_a', 'f_tier', 'Gold', 0);
        INSERT INTO field_value (id, organization_id, field_id, company_id, option_id) VALUES
          ('v1', 'org_a', 'f_tier', 'co_a', 'o_gold');
        INSERT INTO contact (id, organization_id, first_name, email, phone, linkedin_url, company_id) VALUES
          ('p_a', 'org_a', 'Jane', 'jane@acme.test', '+1 555 0100', 'https://linkedin.com/in/jane', 'co_a');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, expected_close_date) VALUES
          ('d_a', 'org_a', 'Pilot', 'co_a', 'user_a', 'DEMO_BOOKED', '2027-03-31T00:00:00.000Z');
        INSERT INTO deal_contact (deal_id, contact_id, organization_id) VALUES ('d_a', 'p_a', 'org_a');
      `);

      expect(await exported("companies")).toMatchObject([
        { Name: "Acme", Domain: "acme.test", Owner: "ana@a.test", Tier: "Gold" },
      ]);
      expect(await exported("contacts")).toMatchObject([
        {
          "First name": "Jane",
          Phone: "+1 555 0100",
          LinkedIn: "https://linkedin.com/in/jane",
          Company: "Acme",
        },
      ]);
      expect(await exported("deals")).toMatchObject([
        {
          Name: "Pilot",
          Company: "Acme",
          Stage: "Demo booked",
          "Close date": "2027-03-31",
          Contacts: "jane@acme.test",
        },
      ]);
    });

    it("exports notes, tasks, email, meetings and website activity, leaving the captured mail out of the notes", async () => {
      await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, email) VALUES
          ('p_a', 'org_a', 'Jane', 'jane@acme.test');
        INSERT INTO email_thread (id, organization_id, root_message_id, contact_id, first_message_at, last_message_at) VALUES
          ('t1', 'org_a', '<m1>', 'p_a', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');
        INSERT INTO email_message (id, organization_id, thread_id, rfc_message_id, direction, from_email, recipients, subject, body, sent_at) VALUES
          ('m1', 'org_a', 't1', '<m1>', 'INBOUND', 'jane@acme.test', '[{"email":"ana@a.test","name":null,"kind":"to"}]', 'Pricing', 'Can we talk?', '2026-10-01T09:00:00.000Z');
        INSERT INTO activity (id, organization_id, type, subject, contact_id, created_by_id, email_thread_id, due_at) VALUES
          ('a_note', 'org_a', 'CALL', 'Intro call', 'p_a', 'user_a', NULL, NULL),
          ('a_mail', 'org_a', 'EMAIL', 'Pricing', 'p_a', NULL, 't1', NULL),
          ('a_task', 'org_a', 'TASK', 'Send deck', 'p_a', 'user_a', NULL, '2026-10-20T09:00:00.000Z');
        INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, title, starts_at, ends_at, status, contact_id) VALUES
          ('e1', 'org_a', 'uid1', '2026-10-02T10:00:00.000Z', 'Demo', '2026-10-02T10:00:00.000Z', '2026-10-02T10:30:00.000Z', 'confirmed', 'p_a');
        INSERT INTO calendar_attendee (id, organization_id, event_id, email) VALUES ('at1', 'org_a', 'e1', 'jane@acme.test');
        INSERT INTO tracked_visitor (organization_id, id, contact_id) VALUES ('org_a', 'visitor_1', 'p_a');
        INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES
          ('ev1', 'org_a', 'visitor_1', 'page_view', 'acme.test', '/pricing', '2026-10-01T08:00:00.000Z');
        INSERT INTO form_submission (id, organization_id, contact_id, host, path, email, fields, dedupe_key) VALUES
          ('fs1', 'org_a', 'p_a', 'acme.test', '/contact', 'jane@acme.test', '{"message":"Call me"}', 'k1');
      `);

      expect(await exported("notes")).toMatchObject([
        { Type: "Call", Subject: "Intro call", Contact: "jane@acme.test" },
      ]);
      expect(await exported("tasks")).toMatchObject([
        { Subject: "Send deck", Author: "ana@a.test" },
      ]);
      expect(await exported("emails")).toMatchObject([
        { To: "ana@a.test", Body: "Can we talk?", Contact: "jane@acme.test" },
      ]);
      expect(await exported("meetings")).toMatchObject([
        { Title: "Demo", Attendees: "jane@acme.test" },
      ]);
      expect(await exported("website-activity")).toMatchObject([
        { Type: "Page view", Path: "/pricing", Contact: "jane@acme.test" },
      ]);
      expect(await exported("form-submissions")).toMatchObject([
        { Fields: "message: Call me", Contact: "jane@acme.test" },
      ]);
    });

    it("is the owner's alone", async () => {
      await expect(
        ExportService.page({ ...OWNER, role: "admin" }, "contacts", null),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
}
