import { beforeEach, describe, expect, it, vi } from "vitest";

// Contacts on both backends: the live-email rule is a partial unique index,
// the list's search and order lean on dialect differences, facts and briefs
// are JSON columns, and a fact is settled by a guarded batch.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// The gateway is connected: research isn't waiting for the model's setup.
vi.mock("@/server/lib/openrouter", () => ({
  getOpenRouterFetch: () => fetch,
}));
// The first-party deployment, which bills: the organization has credits.
const { autumn } = await vi.hoisted(async () => ({
  autumn: (await import("@/server/billing/autumnTestSupport")).autumnMock(),
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn,
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { withBalance } from "@/server/billing/autumnTestSupport";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { toClientError } from "@/server/lib/errors";
import {
  contactListSchema,
  type CreateContactInput,
} from "@/types/schemas/contacts";
import { ContactService } from "./ContactService";

const A = "org_a";
const B = "org_b";

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ContactService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      withBalance(autumn, 500);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    const create = (organizationId: string, input: CreateContactInput) =>
      ContactService.createContact(organizationId, input);

    const names = async (
      organizationId: string,
      input: Record<string, unknown> = {},
    ) => {
      const { rows } = await ContactService.listContacts(
        organizationId,
        contactListSchema.parse({ sort: "name", dir: "asc", ...input }),
      );
      return rows.map((row) =>
        [row.firstName, row.lastName].filter(Boolean).join(" "),
      );
    };

    it("keeps one live contact per email, any case; an archived one keeps theirs", async () => {
      const ana = await create(A, {
        firstName: "Ana",
        lastName: "Zed",
        email: " Ana@Acme.com ",
      });
      // Filed under the company behind the work email, added for the agent,
      // and the team agents hear of both.
      expect(
        await database.rows("SELECT id, name, domain FROM company"),
      ).toMatchObject([
        { id: ana.companyId, name: "acme.com", domain: "acme.com" },
      ]);
      expect(
        await database.rows(
          "SELECT kind, reason, contact_id FROM agent_task ORDER BY kind, reason",
        ),
      ).toMatchObject([
        { kind: "agent-event", reason: "company.created" },
        { kind: "agent-event", reason: "contact.created", contact_id: ana.id },
        { kind: "brand" },
        { kind: "company-profile" },
        { kind: "identify", contact_id: ana.id },
      ]);

      // The browser is told who has the email.
      const taken = await create(A, {
        firstName: "Other",
        email: "ANA@acme.com",
      }).catch((error: unknown) => error);
      expect(getStandardErrorMessage(toClientError(taken))).toBe(
        "Ana Zed already uses ana@acme.com.",
      );
      await expect(
        create(A, { firstName: "Typo", email: "ana@" }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // Free mail says nothing about an employer.
      await expect(
        create(A, { firstName: "Bo", email: "bo@gmail.com" }),
      ).resolves.toMatchObject({ companyId: null });
      // Another organization's Ana is its own.
      await expect(
        create(B, { firstName: "Ana", email: "ana@acme.com" }),
      ).resolves.toMatchObject({ firstName: "Ana" });

      await ContactService.archiveContact(A, ana.id);
      const second = await create(A, {
        firstName: "Ana",
        email: "ana@acme.com",
      });
      expect(second.companyId).toBe(ana.companyId);
      await expect(
        ContactService.restoreContact(A, ana.id),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        ContactService.updateContact(A, { id: second.id, email: "" }),
      ).resolves.toMatchObject({ email: null });
      await expect(
        ContactService.restoreContact(A, ana.id),
      ).resolves.toMatchObject({ name: "Ana Zed" });
      await expect(
        ContactService.updateContact(A, {
          id: second.id,
          email: "ANA@ACME.COM",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("searches every word across name, email and company, and sorts by last name", async () => {
      const ana = await create(A, {
        firstName: "Ana",
        lastName: "Zed",
        email: "ana@acme.com",
      });
      await create(A, {
        firstName: "Bo",
        lastName: "Adams",
        email: "bo@beta.io",
      });
      await create(A, { firstName: "carl" });
      await ContactService.updateContact(A, { id: ana.id, ownerId: "user_a" });

      expect(await names(A, { q: "ana ACME" })).toEqual(["Ana Zed"]);
      expect(await names(A, { q: "beta" })).toEqual(["Bo Adams"]);
      expect(await names(A, { q: "ana beta" })).toEqual([]);
      expect(await names(A, { q: "100%" })).toEqual([]);
      // People known by one name come last either way.
      expect(await names(A)).toEqual(["Bo Adams", "Ana Zed", "carl"]);
      expect(await names(A, { dir: "desc" })).toEqual([
        "Ana Zed",
        "Bo Adams",
        "carl",
      ]);
      expect(await names(A, { sort: "company", dir: "desc" })).toEqual([
        "Bo Adams",
        "Ana Zed",
        "carl",
      ]);
      expect(await names(A, { owner: ["unassigned"] })).toEqual([
        "Bo Adams",
        "carl",
      ]);

      await ContactService.bulkArchive(A, [ana.id]);
      expect(await names(A)).toEqual(["Bo Adams", "carl"]);
      expect(await names(A, { archived: true })).toEqual(["Ana Zed"]);
    });

    it("purges only an archived contact, suppressing their email until a person adds them back", async () => {
      const ana = await create(A, {
        firstName: "Ana",
        lastName: "Zed",
        email: "ana@acme.com",
      });
      const companyId = ana.companyId ?? "";
      await database.exec(`
        INSERT INTO activity (id, organization_id, type, company_id, contact_id, created_at) VALUES ('a1', 'org_a', 'NOTE', '${companyId}', '${ana.id}', '2026-10-10T00:00:00.000Z');
        INSERT INTO activity (id, organization_id, type, company_id, created_at) VALUES ('a2', 'org_a', 'NOTE', '${companyId}', '2026-10-01T00:00:00.000Z');
        UPDATE company SET last_activity_at = '2026-10-10T00:00:00.000Z';
        INSERT INTO agent_event (id, organization_id, session_id, contact_id, type, data, emitted_at) VALUES ('e1', 'org_a', 's1', '${ana.id}', 'step', '{}', '2026-10-01T00:00:00.000Z');
      `);
      const agentRows = () =>
        database.rows(
          `SELECT contact_id FROM agent_task WHERE contact_id IS NOT NULL UNION ALL SELECT contact_id FROM agent_event`,
        );

      await expect(
        ContactService.purgeContact(A, ana.id),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await agentRows()).toHaveLength(3);

      await ContactService.archiveContact(A, ana.id);
      await ContactService.purgeContact(A, ana.id);

      expect(await agentRows()).toHaveLength(0);
      expect(
        await database.rows("SELECT email, reason FROM suppressed_contact"),
      ).toMatchObject([
        { email: "ana@acme.com", reason: "Deleted from the CRM (Ana Zed)" },
      ]);
      expect(
        await database.rows("SELECT last_activity_at FROM company"),
      ).toMatchObject([{ last_activity_at: "2026-10-01T00:00:00.000Z" }]);

      await create(A, { firstName: "Ana", email: "ana@acme.com" });
      expect(
        await database.rows("SELECT email FROM suppressed_contact"),
      ).toHaveLength(0);
    });

    it("moves people between companies, taking away the primary claim they leave", async () => {
      const acme = await CompanyService.createCompany(A, {
        name: "Acme",
        domain: "acme.com",
      });
      const beta = await CompanyService.createCompany(A, {
        name: "Beta",
        domain: "beta.io",
      });
      const elsewhere = await CompanyService.createCompany(B, { name: "B's" });
      const ana = await create(A, { firstName: "Ana", email: "ana@acme.com" });
      const bo = await create(A, { firstName: "Bo", companyId: beta.id });
      expect(ana.companyId).toBe(acme.id);
      await CompanyService.setPrimaryContact(A, acme.id, ana.id);
      expect(await ContactService.getContact(A, ana.id)).toMatchObject({
        isPrimaryContact: true,
        company: { name: "Acme" },
      });

      await ContactService.updateContact(A, { id: ana.id, companyId: beta.id });
      expect(
        await database.rows(
          "SELECT name, primary_contact_id FROM company WHERE organization_id = 'org_a' ORDER BY name",
        ),
      ).toMatchObject([
        { name: "Acme", primary_contact_id: null },
        { name: "Beta", primary_contact_id: null },
      ]);
      expect(
        (await ContactService.getContact(A, ana.id)).relationship.colleagues,
      ).toEqual([{ id: bo.id, name: "Bo", title: null }]);

      await expect(
        ContactService.bulkSetCompany(A, [ana.id, bo.id], elsewhere.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        ContactService.bulkSetCompany(A, [ana.id, bo.id], null),
      ).resolves.toMatchObject({ succeeded: 2, failed: 0 });
    });

    it("shows the live deals a contact is on, open ones first, and the mail captured with them", async () => {
      const ana = await create(A, { firstName: "Ana", email: "ana@acme.com" });
      await database.exec(`
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage) VALUES ('d1', 'org_a', 'Renewal', '${ana.companyId}', 'user_a', 'CLOSED_WON');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage) VALUES ('d2', 'org_a', 'Expansion', '${ana.companyId}', 'user_a', 'CONTRACT_SENT');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, archived_at) VALUES ('d3', 'org_a', 'Dead', '${ana.companyId}', 'user_a', 'DEMO_BOOKED', '2026-10-01T00:00:00.000Z');
        INSERT INTO deal_contact (deal_id, contact_id, organization_id, role) VALUES ('d1', '${ana.id}', 'org_a', 'Champion'), ('d2', '${ana.id}', 'org_a', NULL), ('d3', '${ana.id}', 'org_a', NULL);
        INSERT INTO email_thread (id, organization_id, root_message_id, contact_id, first_message_at, last_message_at, message_count) VALUES ('t1', 'org_a', 'r1', '${ana.id}', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 3);
        INSERT INTO email_message (id, organization_id, thread_id, rfc_message_id, direction, from_email, recipients, sent_at) VALUES ('m1', 'org_a', 't1', 'r1', 'INBOUND', 'ana@acme.com', '[]', '2026-10-02T00:00:00.000Z');
        INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, title, starts_at, ends_at, status) VALUES ('c1', 'org_a', 'u1', '2999-01-01T00:00:00.000Z', 'Kickoff', '2999-01-01T00:00:00.000Z', '2999-01-01T01:00:00.000Z', 'confirmed');
        INSERT INTO calendar_attendee (id, organization_id, event_id, email, contact_id) VALUES ('at1', 'org_a', 'c1', 'ana@acme.com', '${ana.id}');
      `);

      const contact = await ContactService.getContact(A, ana.id);
      expect(contact.deals).toMatchObject([
        { id: "d2", open: true, role: null, owner: { name: "Ana" } },
        { id: "d1", open: false, role: "Champion" },
      ]);
      expect(contact.relationship).toEqual({
        emails: 3,
        threads: 1,
        lastReplyAt: "2026-10-02T00:00:00.000Z",
        meetings: 1,
        nextMeeting: { title: "Kickoff", startsAt: "2999-01-01T00:00:00.000Z" },
        colleagues: [],
      });
    });

    it("sends the agent back when asked, unless it's already on the contact", async () => {
      const ana = await create(A, { firstName: "Ana" });
      await expect(ContactService.enrichContact(A, ana.id)).resolves.toEqual({
        id: ana.id,
        queued: false,
      });

      await database.exec(
        `UPDATE agent_task SET finished_at = '2026-10-01T00:00:00.000Z'; UPDATE contact SET enrichment_status = 'FAILED', enrichment_error = 'Nothing found';`,
      );
      await expect(ContactService.enrichContact(A, ana.id)).resolves.toEqual({
        id: ana.id,
        queued: true,
      });
      expect(await ContactService.getContact(A, ana.id)).toMatchObject({
        enrichmentStatus: "PENDING",
        enrichmentError: null,
        queued: true,
      });
    });

    it("keeps every contact of one organization out of another's reach", async () => {
      const ana = await create(A, { firstName: "Ana", email: "ana@acme.com" });
      await ContactService.archiveContact(
        A,
        (await create(A, { firstName: "Old" })).id,
      );
      const theirs = await CompanyService.createCompany(B, { name: "Theirs" });

      expect(await names(B)).toEqual([]);
      expect(await names(B, { archived: true })).toEqual([]);
      for (const attempt of [
        ContactService.getContact(B, ana.id),
        ContactService.updateContact(B, { id: ana.id, firstName: "Mine" }),
        ContactService.archiveContact(B, ana.id),
        ContactService.enrichContact(B, ana.id),
        ContactService.updateContact(A, { id: ana.id, companyId: theirs.id }),
        create(A, { firstName: "Cy", companyId: theirs.id }),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      // user_a is no member of org_b, and org_b's bulk writes reach nothing.
      await expect(
        ContactService.bulkAssignOwner(B, [ana.id], "user_a"),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      for (const result of [
        await ContactService.bulkAssignOwner(B, [ana.id], "user_b"),
        await ContactService.bulkSetCompany(B, [ana.id], theirs.id),
        await ContactService.bulkArchive(B, [ana.id]),
        await ContactService.bulkPurge(B, [ana.id]),
      ]) {
        expect(result).toMatchObject({ succeeded: 0, failed: 1 });
      }
      expect(await ContactService.getContact(A, ana.id)).toMatchObject({
        firstName: "Ana",
        owner: null,
        archivedAt: null,
      });
    });
  });
}
