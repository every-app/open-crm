import { beforeAll, describe, expect, it, vi } from "vitest";

// The workspace's tools: its members and currencies, website tracking and
// Slack, through the SDK's tools endpoint on real SQL.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", DEPLOYMENT_TIER: "fork" },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));
vi.mock("@/server/features/team-agents/runtime/poke", () => ({
  pokeEvents: vi.fn(),
  pokeRuns: vi.fn(),
}));

import {
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

describe("workspace tools", () => {
  beforeAll(() => testDb.seedTwoOrganizations());

  it("members with their roles, and currencies an owner or admin sets", async () => {
    await call("get_workspace", {}, { as: member });
    expect(await call("list_members")).toMatchObject({
      total: 2,
      members: [
        { name: "Ana", email: ana.email, role: "owner" },
        { email: member.email, role: "member" },
      ],
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
      INSERT INTO tracked_visitor (id, organization_id, contact_id, first_source, first_touch_at, last_source, last_touch_at) VALUES ('vis_1', 'org_a', '${jo}', 'google', '${at}', 'google', '${at}');
      INSERT INTO tracked_event (id, organization_id, visitor_id, type, host, path, occurred_at) VALUES ('ev_1', 'org_a', 'vis_1', 'page_view', 'www.example.test', '/pricing', '${at}');
      INSERT INTO form_submission (id, organization_id, visitor_id, contact_id, host, path, email, fields, dedupe_key, filed_at, created_at) VALUES ('sub_1', 'org_a', 'vis_1', '${jo}', 'www.example.test', '/contact', 'jo@acme.test', '{}', 'key_1', '${at}', '${at}');
    `);
    const expected = {
      identified: true,
      views: 1,
      pages: [{ host: "www.example.test", path: "/pricing", views: 1 }],
      firstTouch: { source: "google" },
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

  it("tracking settings: an owner or admin allows a domain and pauses tracking; every member reads them", async () => {
    expect(
      await failure(
        "add_tracked_domain",
        { host: "acme.test" },
        { as: member },
      ),
    ).toBe(OWNERS_ONLY);
    await call("add_tracked_domain", { host: "https://www.acme.test/" });
    await call("set_tracking_paused", { paused: true });
    const settings = await call("get_tracking_settings", {}, { as: member });
    expect(settings).toMatchObject({
      ready: true,
      paused: true,
      domains: [{ host: "www.acme.test", scope: "SITE_AND_SUBDOMAINS" }],
    });
    // The snippet loads the tracker from the CRM's own origin.
    expect(String(settings.snippet)).toContain("https://crm.test/t/crm.js");
    expect(await failure("get_traffic_sources", {}, { as: member })).toBe(
      OWNERS_ONLY,
    );
  });

  it("slack: its people without a connection, its channels only with one", async () => {
    expect(await call("list_slack_people")).toMatchObject({
      sync: "idle",
      people: [
        { email: ana.email, slackHandle: null },
        { email: member.email },
      ],
    });
    expect(await failure("list_slack_channels")).toBe(
      "Slack isn't connected. An owner or admin connects it in Settings → Connections.",
    );
  });
});
