import { beforeEach, describe, expect, it, vi } from "vitest";

// A website form becomes a contact once, by the rules captured mail follows,
// within the hourly cap; everything else is kept with the reason it wasn't.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { TrackingEventRepository } from "@/server/features/tracking/repositories/TrackingEventRepository";
import { TrackingCollectorService } from "@/server/features/tracking/services/TrackingCollectorService";
import { WebsiteActivityService } from "@/server/features/tracking/services/WebsiteActivityService";
import {
  batch,
  formSubmit,
  pageView,
  readySite,
} from "@/server/features/tracking/testing/trackingTestSupport";
import {
  CONTACTS_PER_HOUR,
  hourWindow,
} from "@/server/features/tracking/trackingRules";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";

const A = "org_a";
const B = "org_b";
const BROWSER = { origin: "https://acme.com", userAgent: "Mozilla/5.0" };

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`TrackingFilingService (${dialect})`, () => {
    const database = testDb.use(dialect);
    let siteId: string;
    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(
        `DELETE FROM tracking_counter; DELETE FROM tracked_event; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      siteId = await readySite(A, "acme.com");
    });

    const submit = (fields: Record<string, string>, visitorId?: string) =>
      TrackingCollectorService.accept(
        batch(
          siteId,
          [
            formSubmit("acme.com", fields, {
              touch: {
                source: "newsletter",
                medium: "email",
                campaign: "fall",
              },
            }),
          ],
          visitorId,
        ),
        BROWSER,
      );

    const submissions = () =>
      database.rows(
        "SELECT organization_id, email, contact_id, skip_reason, fields FROM form_submission ORDER BY skip_reason",
      );
    const contacts = () =>
      database.rows(
        "SELECT organization_id, first_name, last_name, email, source FROM contact",
      );

    it("files a new person as a contact once, with the note (under the workspace's first member, as they have no owner) and their visit", async () => {
      await TrackingCollectorService.accept(
        batch(siteId, [pageView("acme.com", { path: "/pricing" })]),
        BROWSER,
      );
      const fields = {
        first_name: "Jane",
        last_name: "Doe",
        email: "Jane.Doe@Northwind.example",
        password: "hunter2",
        card: "4111 1111 1111 1111",
      };
      await submit(fields);
      // A resend inside the minute is the same submission.
      await submit(fields);

      expect(await contacts()).toEqual([
        {
          organization_id: A,
          first_name: "Jane",
          last_name: "Doe",
          email: "jane.doe@northwind.example",
          source: "TRACKING",
        },
      ]);
      expect(await submissions()).toMatchObject([{ skip_reason: null }]);
      // Sensitive fields never reach storage.
      expect(JSON.stringify(await submissions())).not.toMatch(/hunter2|4111/);
      expect(
        await database.rows(
          "SELECT type, subject, created_by_id FROM activity",
        ),
      ).toEqual([
        {
          type: "NOTE",
          subject: "Submitted a form on acme.com",
          created_by_id: "user_a",
        },
      ]);
      // Anyone can submit a form: the agent researches nobody until a person
      // opens them.
      expect(
        await database.rows(
          "SELECT kind FROM agent_task WHERE contact_id IS NOT NULL",
        ),
      ).toEqual([]);

      const contactId =
        (
          await ContactRepository.findLiveByEmail(
            A,
            "jane.doe@northwind.example",
          )
        )?.id ?? "";
      const activity = await WebsiteActivityService.forRecord(A, { contactId });
      expect(activity).toMatchObject({
        identified: true,
        views: 1,
        pages: [{ host: "acme.com", path: "/pricing", views: 1 }],
        firstTouch: { label: "newsletter · email · fall" },
      });
      // Another organization asking about the same id sees nothing.
      expect(
        await WebsiteActivityService.forRecord(B, { contactId }),
      ).toMatchObject({ identified: false, pages: [] });
    });

    it("files under the existing contact, the note under their owner, without charging the hourly cap", async () => {
      // Cy, who joined after Ana, owns Jane.
      await database.exec(
        `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@a.test', true);
         INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', '${A}', 'user_c', 'member', '2026-01-01T00:00:00.000Z');`,
      );
      const jane = await ContactService.createContact(A, {
        firstName: "Jane",
        email: "jane@northwind.example",
        ownerId: "user_c",
      });
      await fillCap();
      await submit({ email: "JANE@northwind.example" });
      expect(await contacts()).toHaveLength(1);
      expect(await submissions()).toMatchObject([
        { skip_reason: null, contact_id: jane.id },
      ]);
      expect(
        await database.rows(
          "SELECT created_by_id FROM activity WHERE type = 'NOTE'",
        ),
      ).toEqual([{ created_by_id: "user_c" }]);
    });

    it("declines once the hour's new contacts are used up", async () => {
      await fillCap();
      await submit({ email: "jane@northwind.example" });
      expect(await contacts()).toEqual([]);
      expect(await submissions()).toMatchObject([
        {
          contact_id: null,
          skip_reason: "Hourly contact cap reached: not filed",
        },
      ]);
    });

    it("never brings back a deleted contact's address or a suppressed domain", async () => {
      await database.exec(
        `INSERT INTO suppressed_contact (organization_id, email) VALUES ('${A}', 'gone@northwind.example');
         INSERT INTO suppressed_domain (organization_id, domain) VALUES ('${A}', 'blocked.example');`,
      );
      await submit({ email: "gone@northwind.example" });
      await submit({ email: "someone@blocked.example" }, "visitor_0002");
      expect(await contacts()).toEqual([]);
      expect(await submissions()).toMatchObject([
        { skip_reason: "This address was deleted by a person" },
        { skip_reason: "This domain is suppressed" },
      ]);
    });

    it("keeps shared mailboxes and the organization's own addresses out", async () => {
      await WorkspaceRepository.update(A, { website: "https://acme.com" });
      await submit({ email: "sales@northwind.example" });
      await submit({ email: "ana@acme.com" }, "visitor_0002");
      expect(await contacts()).toEqual([]);
      expect(await submissions()).toMatchObject([
        { skip_reason: "Not an address a person reads" },
        { skip_reason: "One of our own addresses" },
      ]);
    });

    it("keeps the members' work domains out, but never a free-mail one", async () => {
      // Ana signs in at a.test; Cy, another member, with Gmail.
      await database.exec(
        `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@gmail.com', true);
         INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', '${A}', 'user_c', 'member', '2026-01-01T00:00:00.000Z');`,
      );
      await submit({ email: "lee@a.test" });
      await submit({ email: "jane@gmail.com" }, "visitor_0002");
      expect(
        await database.rows(
          "SELECT email, skip_reason FROM form_submission ORDER BY email",
        ),
      ).toEqual([
        { email: "jane@gmail.com", skip_reason: null },
        { email: "lee@a.test", skip_reason: "One of our own addresses" },
      ]);
    });
  });
}

async function fillCap() {
  const window = hourWindow(new Date());
  await TrackingEventRepository.take(
    A,
    `contacts:${window.key}`,
    CONTACTS_PER_HOUR,
    CONTACTS_PER_HOUR,
    window.expiresAt,
  );
}
