import { waitUntil } from "cloudflare:workers";
import { runVisibleLane } from "@/server/features/agent/dispatch";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Connecting Slack through the gateway's OAuth client: only an owner or admin,
// only with a state minted for them, and the tokens stay on the server,
// encrypted. Then the people and channel inventory, matched by exact email,
// per organization, whose channels only an owner or admin joins or creates.
const { database, gateway } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    gateway: { exchange: vi.fn<typeof fetch>() },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
vi.mock("@every-app/sdk/server", () => ({
  ConfigurationError: class extends Error {},
  integrationStatus: async () => ({ ready: true, clientId: "client-123" }),
  integrationFetch: () => gateway.exchange,
}));

import { SlackRepository } from "../repositories/SlackRepository";
import { SlackService } from "./SlackService";

const owner = { organizationId: "org_a", userId: "user_a", role: "owner" };
const member = { organizationId: "org_a", userId: "user_a", role: "member" };
const outsider = { organizationId: "org_b", userId: "user_b", role: "owner" };
const web = { channel: "web", origin: "https://crm.example.com" };

const granted = {
  ok: true,
  access_token: "xoxb-bot-secret",
  scope: "chat:write,users:read,users:read.email,channels:read",
  bot_user_id: "UBOT",
  team: { id: "T1", name: "Acme HQ" },
  authed_user: { access_token: "xoxp-user-secret", scope: "channels:write" },
};

/**
 * Slack's Web API for the inventory reads: Ana and Cy as people (and a bot),
 * and two channels, one archived.
 */
function stubSlack() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      const method = url.pathname.split("/").pop();
      if (method === "auth.test") {
        return Response.json({ ok: true, user: "crm", bot_id: "B1" });
      }
      if (method === "bots.info" && url.searchParams.get("bot") === "B1") {
        return Response.json({ ok: true, bot: { name: "Acme CRM" } });
      }
      if (method === "users.list") {
        return Response.json({
          ok: true,
          members: [
            { id: "U1", name: "ana", profile: { email: "ANA@a.test" } },
            { id: "U3", name: "cy", profile: { email: "cy@a.test" } },
            {
              id: "U2",
              name: "bot",
              is_bot: true,
              profile: { email: "bo@b.test" },
            },
          ],
        });
      }
      return Response.json({
        ok: true,
        channels: [
          { id: "C1", name: "sales", num_members: 4, is_member: true },
          { id: "C2", name: "old", is_archived: true },
        ],
      });
    }),
  );
}

/**
 * Every read started after the response, finished: the read queued, and the
 * dispatcher's run of it that queueing started.
 */
async function backgroundReads() {
  for (let done = 0; done < vi.mocked(waitUntil).mock.calls.length; ) {
    const started = vi.mocked(waitUntil).mock.calls.slice(done);
    done += started.length;
    await Promise.all(started.map(([read]) => read));
  }
}

/** The state Slack hands back, from a connect the owner started. */
async function startedState() {
  const { url } = await SlackService.startConnect(owner, web);
  const params = new URL(url).searchParams;
  expect(params.get("client_id")).toBe("client-123");
  expect(params.get("redirect_uri")).toBe(
    "https://crm.example.com/integrations/slack/callback",
  );
  return params.get("state");
}

describe("SlackService", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    gateway.exchange.mockResolvedValue(Response.json(granted));
    stubSlack();
  });

  // What a test started in the background ends before the next one.
  afterEach(async () => {
    await backgroundReads();
    vi.unstubAllGlobals();
  });

  it("connects once per state, for an owner or admin, keeping the tokens server-side", async () => {
    await expect(SlackService.startConnect(member, web)).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(
      SlackService.startConnect(owner, { ...web, channel: "mcp" }),
    ).rejects.toThrow("FORBIDDEN");

    const state = await startedState();
    const callback = { ...web, code: "code-1", state, error: null };
    expect(await SlackService.completeConnect(outsider, callback)).toBe(
      "invalid_state",
    );
    expect(await SlackService.completeConnect(owner, callback)).toBe(
      "connected",
    );
    // Spent: a replayed callback does nothing.
    expect(await SlackService.completeConnect(owner, callback)).toBe(
      "invalid_state",
    );
    const body = gateway.exchange.mock.calls[0]?.[1]?.body;
    const form = body instanceof URLSearchParams ? body : null;
    expect(form?.get("code")).toBe("code-1");
    expect(form?.has("client_secret")).toBe(false);

    const status = await SlackService.status(owner);
    expect(status).toMatchObject({
      connected: true,
      workspace: "Acme HQ",
      canInviteItself: true,
    });
    expect(JSON.stringify(status)).not.toContain("xox");
    expect(await SlackService.status(outsider)).toMatchObject({
      connected: false,
    });
    expect(
      JSON.stringify(await database.rows(`SELECT * FROM slack_connection`)),
    ).not.toContain("secret");
    expect(await SlackRepository.getTokens("org_a")).toEqual({
      botToken: "xoxb-bot-secret",
      userToken: "xoxp-user-secret",
    });
  });

  it("leaves joining and creating channels, and the private ones the app isn't in, to owners and admins", async () => {
    const state = await startedState();
    await SlackService.completeConnect(owner, {
      ...web,
      code: "c",
      state,
      error: null,
    });
    await backgroundReads();
    await database.exec(
      `INSERT INTO slack_channel (id, organization_id, slack_channel_id, name, is_private, is_member) VALUES ('ch_p', 'org_a', 'CP', 'leadership', 1, 0);`,
    );
    const names = async (context: typeof owner) =>
      (await SlackInventoryService.channels(context, { offset: 0 })).rows.map(
        (row) => row.name,
      );

    expect(await names(owner)).toEqual(["sales", "leadership"]);
    expect(await names(member)).toEqual(["sales"]);
    await expect(
      SlackInventoryService.joinChannel(member, "C1"),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      SlackInventoryService.createChannel(member, {
        name: "deals",
        isPrivate: false,
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("matches members to Slack users by exact email and keeps the inventory per organization", async () => {
    const state = await startedState();
    await SlackService.completeConnect(owner, {
      ...web,
      code: "c",
      state,
      error: null,
    });
    await database.exec(
      `INSERT INTO slack_channel (id, organization_id, slack_channel_id, name) VALUES ('ch_b', 'org_b', 'CB', 'theirs');`,
    );
    await SlackInventoryService.refresh(owner);
    await backgroundReads();

    expect((await SlackInventoryService.matches(owner)).rows).toEqual([
      expect.objectContaining({
        userId: "user_a",
        slackHandle: "@ana",
        reviewed: true,
      }),
    ]);
    const channels = await SlackInventoryService.channels(owner, { offset: 0 });
    expect(channels.rows.map((row) => row.name)).toEqual(["sales"]);
    // `/invite @…` takes the app's name in the workspace, read from Slack.
    expect(await SlackService.status(owner)).toMatchObject({
      appName: "Acme CRM",
    });
    await expect(
      SlackInventoryService.channels(outsider, { offset: 0 }),
    ).rejects.toThrow("SLACK_UNAVAILABLE");
    // org_a's read leaves org_b's channels as they were.
    expect(
      await database.rows(
        `SELECT available FROM slack_channel WHERE organization_id = 'org_b'`,
      ),
    ).toEqual([{ available: 1 }]);
    expect(
      (await SlackInventoryService.builderInventory("org_b")).channels,
    ).toEqual([]);

    await expect(SlackService.disconnect(member, "web")).rejects.toThrow(
      "FORBIDDEN",
    );
    await SlackService.disconnect(owner, "web");
    expect(await SlackService.status(owner)).toMatchObject({
      connected: false,
    });
  });

  it("matches the members again once someone joins after the last match", async () => {
    const state = await startedState();
    await SlackService.completeConnect(owner, {
      ...web,
      code: "c",
      state,
      error: null,
    });
    await backgroundReads();
    const reads = vi.mocked(waitUntil).mock.calls.length;

    // Nobody new: the status reads nothing from Slack.
    await SlackService.status(owner);
    expect(vi.mocked(waitUntil).mock.calls).toHaveLength(reads);

    await database.exec(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@a.test', 1);
       INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_c', 'org_a', 'user_c', 'member', 0);`,
    );
    await SlackService.status(member);
    await backgroundReads();
    expect((await SlackInventoryService.matches(owner)).rows).toEqual([
      expect.objectContaining({ userId: "user_a", slackHandle: "@ana" }),
      expect.objectContaining({ userId: "user_c", slackHandle: "@cy" }),
    ]);
  });

  it("reads Slack a page at a time, and a run that fails or is rate limited goes on from the page it stopped at", async () => {
    const state = await startedState();
    await SlackService.completeConnect(owner, {
      ...web,
      code: "c",
      state,
      error: null,
    });
    await backgroundReads();
    // Ana is on the second page of people, which fails the first time and is
    // rate limited the second.
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (!url.pathname.endsWith("/users.list")) {
          return Response.json({ ok: true, channels: [] });
        }
        const cursor = url.searchParams.get("cursor") ?? "";
        asked.push(cursor);
        if (!cursor) {
          return Response.json({
            ok: true,
            members: [],
            response_metadata: { next_cursor: "page-2" },
          });
        }
        if (asked.length === 2) throw new TypeError("fetch failed");
        if (asked.length === 3) {
          return Response.json(
            { ok: false, error: "ratelimited" },
            { status: 429, headers: { "retry-after": "30" } },
          );
        }
        return Response.json({
          ok: true,
          members: [
            { id: "U1", name: "ana.m", profile: { email: "ana@a.test" } },
          ],
        });
      }),
    );
    await SlackInventoryService.refresh(owner);
    await backgroundReads();
    // Its lease runs out, and the dispatcher takes it again; then Slack's
    // pause is over.
    const due = async () =>
      database.exec(
        `UPDATE agent_task SET leased_until = NULL, due_at = '2000-01-01T00:00:00.000Z' WHERE finished_at IS NULL`,
      );
    await due();
    await runVisibleLane({ defer: vi.fn() });
    await due();
    await runVisibleLane({ defer: vi.fn() });

    expect(asked).toEqual(["", "page-2", "page-2", "page-2"]);
    expect((await SlackInventoryService.matches(owner)).rows).toEqual([
      expect.objectContaining({ userId: "user_a", slackHandle: "@ana.m" }),
    ]);
  });
});
