import { beforeEach, describe, expect, it, vi } from "vitest";

// The evidence ledger, people, socials and custom field tools at the registry
// the agent calls them through: whose records each may touch, and which wait
// for a person. Vendors are stubbed (toolTestSupport.ts); no network.
const { database, contextFetch } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    contextFetch: vi.fn<typeof fetch>(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));
vi.mock("@/db/runBatch", () => ({ runBatch: database.runBatch }));
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));
vi.mock("@/server/lib/provider-access", () => ({
  getContextFetch: async () => contextFetch,
  hasContextAccess: async () => true,
}));
vi.mock("../lib/perplexity", () => ({
  webResearchAccess: async () => null,
  asker: vi.fn(),
}));
vi.mock("@/server/lib/images", () => ({
  imageStorageReady: () => true,
  storeImage: vi.fn(),
}));

import {
  enriched,
  LINKEDIN_CLAIM,
  PAULA,
  says,
  toolSession,
} from "./toolTestSupport";

/** Sets a custom field on org_a's contact through `session`'s set_field_value. */
function set(
  session: ReturnType<typeof toolSession>,
  key: string,
  value: unknown,
) {
  return session.call("set_field_value", {
    entity: "CONTACT",
    recordId: "c_a",
    key,
    value,
  });
}

describe("the agent's ledger, people and field tools", () => {
  beforeEach(async () => {
    contextFetch.mockImplementation(async () => enriched(PAULA));
    await database.exec(
      `DELETE FROM activity; DELETE FROM contact_fact; DELETE FROM field_value; DELETE FROM field_option; DELETE FROM field_definition;
       DELETE FROM agent_task; DELETE FROM workspace_profile; DELETE FROM workspace; DELETE FROM contact; DELETE FROM company; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES
         ('co_a', 'org_a', 'Fernhill', 'fernhill.test'), ('co_new', 'org_a', 'Comp AI', 'comp.test'), ('co_b', 'org_b', 'Bolt', 'bolt.test');
       INSERT INTO contact (id, organization_id, first_name, last_name, email, company_id, owner_id, linkedin_url) VALUES
         ('c_a', 'org_a', 'Paula', 'Marchetti', 'pmarchetti@fernhill.test', 'co_a', 'user_a', 'https://www.linkedin.com/in/paulamarchetti');
       INSERT INTO contact_fact (id, organization_id, contact_id, field, value, score, band, evidence, method, status, observed_at, superseded_at) VALUES
         ('f_old', 'org_a', 'c_a', 'employer', 'Fleetio', 0.85, 'VERIFIED', '[]', 'linkedin.profile', 'SUPERSEDED', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
         ('f_new', 'org_a', 'c_a', 'employer', 'Comp AI', 0.85, 'VERIFIED', '[]', 'linkedin.profile', 'APPLIED', '2026-06-01T00:00:00.000Z', NULL);
       INSERT INTO field_definition (id, organization_id, entity, key, label, type, agent_filled, agent_brief, position) VALUES
         ('fd_seats', 'org_a', 'CONTACT', 'seats', 'Seats', 'NUMBER', 1, NULL, 0),
         ('fd_notes', 'org_a', 'CONTACT', 'notes', 'Notes', 'TEXT', 0, 'Their own words.', 1),
         ('fd_seats_b', 'org_b', 'CONTACT', 'seats', 'Seats', 'NUMBER', 1, NULL, 0);`,
    );
  });

  it("keeps every tool to its own organization's records", async () => {
    const other = toolSession({ organizationId: "org_b", role: "owner" });
    const evidence = [{ kind: "crm.thread-reply", detail: "they replied" }];
    const noContact = { reason: "No such contact." };
    const calls: [string, object, object][] = [
      [
        "record_fact",
        {
          contactId: "c_a",
          field: "title",
          value: "Mole",
          evidence,
          method: "x",
        },
        noContact,
      ],
      [
        "identify_contact",
        { contactId: "c_a", fullName: "Mo Le", evidence, sourceUrl: "x" },
        noContact,
      ],
      [
        "record_job_change",
        { contactId: "c_a" },
        { raised: false, reason: says("No employer change") },
      ],
      ["get_contact_work_history", { contactId: "c_a" }, noContact],
      ["get_linkedin_profile", LINKEDIN_CLAIM, { photo: noContact }],
      ["find_contact_socials", { contactId: "c_a" }, noContact],
      [
        "set_contact_socials",
        { contactId: "c_a", githubUrl: "https://github.com/paulam" },
        noContact,
      ],
      ["fetch_contact_photo", { contactId: "c_a" }, noContact],
      [
        "set_field_value",
        { entity: "CONTACT", recordId: "c_a", key: "seats", value: 3 },
        { written: false, reason: "No contact with id c_a." },
      ],
      [
        "list_fields",
        { entity: "CONTACT" },
        { fields: [{ key: "seats", agentFilled: true }] },
      ],
      [
        "manage_fields",
        { action: "update-brief", entity: "CONTACT", key: "notes" },
        { updated: false },
      ],
      [
        "archive_field",
        { entity: "CONTACT", key: "notes" },
        { archived: false },
      ],
    ];
    for (const [name, input, refused] of calls) {
      expect(await other.call(name, input), name).toMatchObject(refused);
    }

    expect(
      await database.rows(
        "SELECT title, github_url, image_url, company_id FROM contact",
      ),
    ).toEqual([
      { title: null, github_url: null, image_url: null, company_id: "co_a" },
    ]);
    expect(await database.rows("SELECT id FROM contact_fact")).toHaveLength(2);
    expect(await database.rows("SELECT id FROM activity")).toEqual([]);
    expect(await database.rows("SELECT id FROM field_value")).toEqual([]);
    expect(
      await database.rows(
        "SELECT agent_brief, archived_at FROM field_definition WHERE id = 'fd_notes'",
      ),
    ).toEqual([{ agent_brief: "Their own words.", archived_at: null }]);
  });

  it("raises a job change only with a person there to approve it", async () => {
    const unattended = toolSession({ attended: false, role: null });
    expect(unattended.tools.record_job_change?.needsApproval).toBe(false);
    expect(
      await unattended.call("record_job_change", { contactId: "c_a" }),
    ).toMatchObject({ raised: false, reason: says("unattended") });
    expect(await database.rows("SELECT id FROM activity")).toEqual([]);

    const chat = toolSession();
    expect(chat.tools.record_job_change?.needsApproval).toBe(true);
    // Another organization's company is no company of ours.
    expect(
      await chat.call("record_job_change", {
        contactId: "c_a",
        moveToCompanyId: "co_b",
      }),
    ).toMatchObject({ raised: false });
    expect(
      await chat.call("record_job_change", {
        contactId: "c_a",
        moveToCompanyId: "co_new",
      }),
    ).toEqual({
      raised: true,
      from: "Fleetio",
      to: "Comp AI",
      moved: true,
      ownerNotified: true,
    });
    expect(
      await database.rows(
        "SELECT type, subject, company_id, created_by_id FROM activity",
      ),
    ).toEqual([
      {
        type: "NOTE",
        subject: "Paula Marchetti has moved to Comp AI",
        company_id: "co_a",
        created_by_id: null,
      },
    ]);
    expect(await database.rows("SELECT company_id FROM contact")).toEqual([
      { company_id: "co_new" },
    ]);
  });

  it("changes fields only for an owner or admin, and only on their approval", async () => {
    const create = {
      action: "create",
      entity: "CONTACT",
      label: "Renewal date",
      type: "DATE",
    };
    for (const refused of [
      toolSession({ role: "member" }),
      toolSession({ attended: false, role: null }),
    ]) {
      expect(await refused.call("manage_fields", create)).toMatchObject({
        created: false,
      });
      expect(refused.tools.manage_fields?.needsApproval).toBe(false);
      expect(refused.tools.archive_field?.needsApproval).toBe(false);
      expect(
        await refused.call("archive_field", {
          entity: "CONTACT",
          key: "notes",
        }),
      ).toMatchObject({ archived: false });
    }

    const admin = toolSession({ role: "admin" });
    expect(await admin.call("manage_fields", create)).toMatchObject({
      key: "renewal_date",
      type: "DATE",
      agentFilled: true,
    });
    expect(admin.tools.manage_fields?.needsApproval).toBe(true);
    expect(admin.tools.archive_field?.needsApproval).toBe(true);
    expect(
      await admin.call("archive_field", { entity: "CONTACT", key: "notes" }),
    ).toEqual({ archived: true });
    expect(
      await database.rows(
        "SELECT key FROM field_definition WHERE organization_id = 'org_a' AND archived_at IS NULL ORDER BY key",
      ),
    ).toEqual([{ key: "renewal_date" }, { key: "seats" }]);
  });

  it("rewrites the company profile in a chat only for an owner or admin, and unattended only in its own task", async () => {
    await database.exec(
      "INSERT INTO workspace (organization_id, name, website) VALUES ('org_a', 'A', 'a.test');",
    );
    const profile = {
      narrative:
        "Fernhill sells fleet software to logistics companies and charges per vehicle.",
      sells: "Fleet software",
    };
    for (const refused of [
      toolSession({ role: "member" }),
      // Research on a record an outsider may have written.
      toolSession({
        attended: false,
        role: null,
        task: { id: "t1", kind: "identify" },
      }),
    ]) {
      expect(
        await refused.call("write_workspace_profile", profile),
      ).toMatchObject({ written: false });
    }
    expect(
      await database.rows("SELECT narrative FROM workspace_profile"),
    ).toEqual([]);
    expect(
      await toolSession({ role: "admin" }).call(
        "write_workspace_profile",
        profile,
      ),
    ).not.toMatchObject({ written: false });
  });

  it("researches a company from up to eight pages of its site, for one lookup's budget", async () => {
    contextFetch.mockImplementation(async () =>
      Response.json({ data: { positioning: "Fleet software, per vehicle." } }),
    );
    const chat = toolSession();
    expect(
      await chat.call("research_company", { companyId: "co_a" }),
    ).toMatchObject({ written: true });
    const [url, init] = contextFetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.context.dev/v1/web/extract");
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    ).toMatchObject({
      url: "https://fernhill.test",
      maxPages: 8,
    });
    expect(chat.budget.spent).toBe(2);
    expect(
      await database.rows(
        "SELECT subject, body FROM activity WHERE company_id = 'co_a'",
      ),
    ).toEqual([
      {
        subject: "Research brief — Fernhill",
        body: "Fleet software, per vehicle.",
      },
    ]);
  });

  it("sets a custom value as a person would, never a manual one, and backfills only a blank", async () => {
    const chat = toolSession();
    expect(await set(chat, "notes", "Hates golf")).toMatchObject({
      written: false,
      reason: says("manual only"),
    });
    expect(await set(chat, "seats", "a dozen")).toEqual({
      written: false,
      reason: "Seats takes a number.",
    });
    expect(await set(chat, "seats", 12)).toEqual({
      written: true,
      key: "seats",
      value: 12,
    });

    const backfill = toolSession({
      attended: false,
      task: { id: "t1", kind: "field-backfill" },
    });
    expect(await set(backfill, "seats", 40)).toMatchObject({
      written: false,
      reason: says("already has a value"),
    });
    expect(await database.rows("SELECT number FROM field_value")).toEqual([
      { number: 12 },
    ]);
  });
});
