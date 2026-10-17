import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Connecting Slack through the gateway's OAuth client: only an owner or admin,
// only with a state minted for them, and the tokens stay on the server. Then
// the people and channel inventory, matched by exact email, per organization.
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
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(await SlackService.status(outsider)).toMatchObject({
      connected: false,
    });
  });

  it("matches members to Slack users by exact email and keeps the inventory per organization", async () => {
    const state = await startedState();
    await SlackService.completeConnect(owner, {
      ...web,
      code: "c",
      state,
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        const method = url.pathname.split("/").pop();
        if (method === "users.list") {
          return Response.json({
            ok: true,
            members: [
              { id: "U1", name: "ana", profile: { email: "ANA@a.test" } },
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
    await SlackInventoryService.sync("org_a");
    vi.unstubAllGlobals();

    expect((await SlackInventoryService.matches(owner)).rows).toEqual([
      expect.objectContaining({
        userId: "user_a",
        slackHandle: "@ana",
        reviewed: true,
      }),
    ]);
    const channels = await SlackInventoryService.channels(owner, { offset: 0 });
    expect(channels.rows.map((row) => row.name)).toEqual(["sales"]);
    await expect(
      SlackInventoryService.channels(outsider, { offset: 0 }),
    ).rejects.toThrow("SLACK_UNAVAILABLE");
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
});
