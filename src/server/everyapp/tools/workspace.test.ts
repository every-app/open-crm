import { beforeAll, describe, expect, it, vi } from "vitest";

// The workspace's tools: its members, archive retention and currencies,
// and website tracking, through the SDK's tools endpoint on real SQL.
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

const member: Caller = {
  sub: "user_c",
  email: "cy@a.test",
  orgId: "org_a",
  orgRole: "member",
};

const OWNERS_ONLY = "Only an owner or an admin can do that.";

const readOnly = { scopes: ["mcp:read"] };

describe("workspace tools", () => {
  beforeAll(() => testDb.seedTwoOrganizations());

  it("who the caller is; members with their roles, found by name, email or role and sorted; currencies an owner or admin sets", async () => {
    expect(await call("get_workspace", {}, { as: member })).toMatchObject({
      caller: { id: member.sub, email: member.email },
      role: "member",
    });
    expect(await call("list_members")).toMatchObject({
      total: 2,
      members: [
        {
          id: ana.sub,
          name: "Ana",
          email: ana.email,
          role: "owner",
          isCaller: true,
        },
        { id: member.sub, email: member.email, isCaller: false },
      ],
    });
    expect(
      await call("list_members", { query: "CY@", roles: ["member"] }, readOnly),
    ).toMatchObject({ total: 1, members: [{ email: member.email }] });
    expect(
      await call("list_members", { sort: "role", direction: "desc" }),
    ).toMatchObject({
      members: [{ email: member.email }, { email: ana.email }],
    });
    expect(
      await failure(
        "set_exchange_rate",
        { currency: "EUR", rate: 1.1 },
        {
          as: member,
        },
      ),
    ).toBe(OWNERS_ONLY);
    expect(
      await call("set_exchange_rate", { currency: "eur", rate: 1.1 }),
    ).toMatchObject({
      reportingCurrency: "USD",
      rates: [{ currency: "EUR", rate: 1.1, source: "MANUAL" }],
    });
    expect(await call("get_currency_settings", {}, { as: bo })).toMatchObject({
      rates: [],
    });
  });

  it("archive retention: every member reads it; an owner or admin sets it with the destructive scope", async () => {
    const destructive = { scopes: [...READ_WRITE, "mcp:destructive"] };
    expect(
      await call("get_workspace", {}, { ...readOnly, as: member }),
    ).toMatchObject({ archiveRetentionDays: 180 });
    expect(
      await failure(
        "set_archive_retention",
        { days: 30 },
        { ...destructive, as: member },
      ),
    ).toBe(OWNERS_ONLY);
    expect(
      await call("set_archive_retention", { days: 30 }, destructive),
    ).toMatchObject({ archiveRetentionDays: 30 });
    expect(await call("get_workspace", {}, { as: bo })).toMatchObject({
      archiveRetentionDays: 180,
    });
  });

  it("website activity: a contact's and their company's visits and form submissions, nobody else's", async () => {
    const companyId = await idFrom("create_company", {
      name: "Acme",
      domain: "acme.test",
    });
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      email: "jo@acme.test",
    });
    const at = "2026-10-01T10:00:00.000Z";
    await testDb.exec(`
      INSERT INTO tracked_visitor (id, organization_id, contact_id, first_source, first_referrer, first_touch_at, last_source, last_touch_at) VALUES ('vis_1', 'org_a', '${jo}', 'google', 'https://www.google.com/', '${at}', 'google', '${at}');
      INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ('ev_1', 'org_a', 'vis_1', 'page_view', 'www.example.test', '/pricing', '${at}');
      INSERT INTO form_submission (id, organization_id, visitor_id, contact_id, host, path, email, fields, dedupe_key, filed_at, created_at) VALUES ('sub_1', 'org_a', 'vis_1', '${jo}', 'www.example.test', '/contact', 'jo@acme.test', '{}', 'key_1', '${at}', '${at}');
    `);
    const expected = {
      identified: true,
      views: 1,
      pages: [{ host: "www.example.test", path: "/pricing", views: 1 }],
      firstTouch: { source: "google", referrer: "https://www.google.com/" },
      submissions: [
        {
          host: "www.example.test",
          path: "/contact",
          submittedAt: at,
          contact: { id: jo, name: "Jo" },
        },
      ],
    };
    expect(
      await call("get_website_activity", { kind: "contact", id: jo }),
    ).toMatchObject(expected);
    expect(
      await call("get_website_activity", { kind: "company", id: companyId }),
    ).toMatchObject(expected);
    expect(
      await call(
        "get_website_activity",
        { kind: "contact", id: jo },
        { as: bo },
      ),
    ).toMatchObject({ identified: false, submissions: [] });
  });

  it("tracking settings: an owner or admin allows a domain, pauses tracking and sets its rules and cookies; every member reads them", async () => {
    expect(
      await failure(
        "add_tracked_domain",
        { host: "acme.test" },
        { as: member },
      ),
    ).toBe(OWNERS_ONLY);
    expect(
      await failure(
        "update_tracking_settings",
        { honourDnt: false },
        {
          as: member,
        },
      ),
    ).toBe(OWNERS_ONLY);
    await call("add_tracked_domain", { host: "https://www.acme.test/" });
    await call("set_tracking_paused", { paused: true });
    await call("update_tracking_settings", {
      crossDomain: false,
      cookieSubdomains: true,
      cookieDays: 0,
    });
    const settings = await call(
      "get_tracking_settings",
      {},
      {
        ...readOnly,
        as: member,
      },
    );
    expect(settings).toMatchObject({
      ready: true,
      paused: true,
      crossDomain: false,
      limitToDomains: true,
      cookieSubdomains: true,
      secureCookies: true,
      honourDnt: true,
      cookieDays: 0,
      domains: [{ host: "www.acme.test", scope: "SITE_AND_SUBDOMAINS" }],
    });
    // The snippet loads the tracker from the CRM's own origin; Tag Manager's
    // carries the site id in its URL.
    expect(String(settings.snippet)).toContain("https://crm.test/t/crm.js");
    expect(String(settings.tagManagerSnippet)).toContain(
      `https://crm.test/t/crm.js?site=${String(settings.siteId)}`,
    );
    expect(await failure("get_traffic_sources", {}, { as: member })).toBe(
      OWNERS_ONLY,
    );
  });
});
