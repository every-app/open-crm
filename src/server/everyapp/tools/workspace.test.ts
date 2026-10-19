import { waitUntil } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The workspace's tools: its members, archive retention and currencies,
// website tracking and Slack, through the SDK's tools endpoint on real SQL.
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
        { name: "Ana", email: ana.email, role: "owner", isCaller: true },
        { email: member.email, role: "member", isCaller: false },
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

  it("slack: its status and people without a connection; with one, its channels, joining and creating one, and reading Slack again: when a join finds a channel changed, and when someone joined since the people were matched", async () => {
    expect(await call("get_slack_status", {}, readOnly)).toMatchObject({
      available: false,
      connected: false,
      agents: [],
    });
    expect(await call("list_slack_people")).toMatchObject({
      sync: "idle",
      people: [
        {
          email: ana.email,
          reviewed: false,
          slackUserId: null,
          slackHandle: null,
        },
        { email: member.email },
      ],
    });
    expect(await failure("list_slack_channels")).toBe(
      "Slack isn't connected. An owner or admin connects it in Settings → Connections.",
    );

    // Connected, read a moment ago: Ana matched, one channel the app isn't in.
    const at = new Date().toISOString();
    await testDb.exec(`
      INSERT INTO slack_connection (id, organization_id, team_id, team_name, bot_user_id, bot_name, bot_token, bot_scopes, connected_at, synced_at) VALUES ('sc', 'org_a', 'T1', 'Acme HQ', 'UBOT', 'Acme CRM', 'xoxb-test', 'chat:write', '${at}', '${at}');
      INSERT INTO slack_member_match (id, organization_id, user_id, slack_user_id, slack_handle, updated_at) VALUES ('mm_a', 'org_a', 'user_a', 'U1', '@ana', '${at}'), ('mm_c', 'org_a', 'user_c', NULL, NULL, '${at}');
      INSERT INTO slack_channel (id, organization_id, slack_channel_id, name) VALUES ('ch_1', 'org_a', 'C1', 'sales'), ('ch_3', 'org_a', 'C3', 'ops');
    `);
    // Slack has #ops as private now; the list has it as public.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        const method = url.pathname.split("/").pop();
        if (method === "conversations.info") {
          return Response.json({
            ok: true,
            channel: {
              is_private: url.searchParams.get("channel") === "C3",
              is_member: false,
            },
          });
        }
        if (method === "conversations.create") {
          return Response.json({
            ok: true,
            channel: { id: "C2", name: "deal-alerts" },
          });
        }
        return Response.json({ ok: true, members: [], channels: [] });
      }),
    );
    expect(await call("get_slack_status", {}, readOnly)).toMatchObject({
      connected: true,
      workspace: "Acme HQ",
      appName: "Acme CRM",
      sync: "idle",
      people: { matched: 1, total: 2 },
    });
    expect(await call("list_slack_people")).toMatchObject({
      people: [
        {
          email: ana.email,
          reviewed: true,
          slackUserId: "U1",
          slackHandle: "@ana",
        },
        { email: member.email, reviewed: true, slackUserId: null },
      ],
    });
    const reads = () =>
      testDb.rows(`SELECT id FROM agent_task WHERE kind = 'slack-sync'`);
    const settled = () =>
      Promise.all(vi.mocked(waitUntil).mock.calls.map(([read]) => read));
    await settled();
    expect(await reads()).toEqual([]);
    // Someone who opens the CRM after the people were matched is matched
    // when they are listed, as the status would.
    const newcomer = { ...member, sub: "user_d", email: "di@a.test" };
    await call("get_workspace", {}, { as: newcomer });
    expect(await call("list_slack_people")).toMatchObject({
      people: [
        { email: ana.email },
        { email: member.email },
        { email: newcomer.email, reviewed: false, slackUserId: null },
      ],
    });
    await settled();
    expect(await reads()).toHaveLength(1);
    await testDb.exec(`DELETE FROM agent_task WHERE kind = 'slack-sync'`);
    expect(await call("join_slack_channel", { channelId: "C1" })).toEqual({
      outcome: "joined",
      reason: null,
    });
    await settled();
    expect(await reads()).toEqual([]);
    expect(await call("join_slack_channel", { channelId: "C3" })).toEqual({
      outcome: "asked",
      reason: null,
    });
    await settled();
    expect(await reads()).toHaveLength(1);
    expect(await call("create_slack_channel", { name: "deal-alerts" })).toEqual(
      {
        created: true,
        channel: { id: "C2", name: "deal-alerts" },
        reason: null,
      },
    );
    const asked: unknown = expect.any(String);
    expect(await call("list_slack_channels")).toMatchObject({
      channels: [
        { id: "C2", name: "deal-alerts", isMember: true },
        { id: "C1", isMember: true, classified: true, inviteRequestedAt: null },
        {
          id: "C3",
          isPrivate: true,
          isMember: false,
          inviteRequestedAt: asked,
        },
      ],
    });
    expect(await call("get_slack_status", {}, { as: bo })).toMatchObject({
      connected: false,
    });

    expect(await call("refresh_slack")).toEqual({ requested: true });
    await settled();
  });
});
