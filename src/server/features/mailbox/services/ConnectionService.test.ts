import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Connecting a mailbox through the gateway: Connect goes to the gateway's
// connect page, and coming back reads which mailbox the member's connection
// reaches before anything syncs. The CRM never holds a token.
const { database, gateway } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  const { createGateway } =
    await import("@/server/features/mailbox/mailboxTestSupport");
  return {
    database: await createSqliteTestDb(),
    gateway: createGateway(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    EVERY_APP_GATEWAY: gateway.binding,
    GATEWAY_URL: "https://gateway.example.com",
    EVERYAPP_APP_ID: "crm",
  },
  waitUntil: () => {},
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import {
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { ConnectionService } from "./ConnectionService";

const ORIGIN = "https://crm.example.com";
const GMAIL_PROFILE = "gmail.googleapis.com/gmail/v1/users/me/profile";
const PRIMARY_CALENDAR = "www.googleapis.com/calendar/v3/calendars/primary";
// Each with the address the gateway signs them in with, which a mailbox's
// must match in any case.
const ANA = {
  organizationId: "org_a",
  userId: "user_a",
  userEmail: "ana@acme.com",
};
const BO = {
  organizationId: "org_b",
  userId: "user_b",
  userEmail: "Bo@Contoso.com",
};

/** Google's refusal of a call its token's scopes don't cover. */
const insufficientScopes = () =>
  json(
    { error: { message: "Request had insufficient authentication scopes." } },
    403,
  );

describe("ConnectionService", () => {
  beforeEach(async () => {
    gateway.reset();
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
  });

  it("sends the member to the gateway's connect page, which comes back to the CRM", async () => {
    const { url } = await ConnectionService.startConnect("google", ORIGIN);
    const target = new URL(url);
    expect(`${target.origin}${target.pathname}`).toBe(
      "https://gateway.example.com/connect/google-workspace",
    );
    expect(target.searchParams.get("return")).toBe(
      `${ORIGIN}/integrations/google/connected`,
    );
  });

  it("refuses to start a connect the gateway doesn't offer, and shows its own words for what an admin sets", async () => {
    gateway.setReady(false);
    await expect(
      ConnectionService.startConnect("microsoft", ORIGIN),
    ).rejects.toThrow("isn't set up on this Every App gateway");

    const asMember = await ConnectionService.status({ ...ANA, role: "member" });
    expect(asMember.providers[0]).toMatchObject({
      ready: false,
      settings: ["GOOGLE_WORKSPACE_CLIENT_ID"],
      setup: "An admin adds the provider.",
      command: null,
    });
    const asOwner = await ConnectionService.status({ ...ANA, role: "owner" });
    expect(asOwner.providers[0]?.command).toBe("pnpm everyapp provider add");
  });

  it("starts only the sources the member granted, read on their own connection", async () => {
    stubProviders({
      [GMAIL_PROFILE]: insufficientScopes,
      [PRIMARY_CALENDAR]: () => ({ id: "Ana@Acme.com" }),
    });

    expect(await ConnectionService.completeConnect(ANA, "google")).toEqual({
      ok: true,
    });
    expect(
      gateway.calls.map((call) => call.headers.get("x-everyapp-user")),
    ).toEqual(["user_a", "user_a"]);

    const { providers } = await ConnectionService.status({
      ...ANA,
      role: "member",
    });
    const google = providers.find((entry) => entry.provider === "google");
    expect(google?.connection).toMatchObject({
      accountEmail: "ana@acme.com",
      needsReconnect: false,
      sources: [
        {
          source: "calendar",
          granted: true,
          autoCreate: true,
          status: "IDLE",
        },
        { source: "gmail", granted: false, status: null },
      ],
    });
    // No token anywhere in the CRM's database.
    expect(
      await database.rows(
        `SELECT access_token, refresh_token FROM mailbox_connection`,
      ),
    ).toEqual([{ access_token: null, refresh_token: null }]);
  });

  it("stores nothing when the gateway holds no connection for the member", async () => {
    gateway.disconnect("user_a");
    stubProviders({});

    expect(await ConnectionService.completeConnect(ANA, "google")).toEqual({
      ok: false,
      error: "not_connected",
    });
    expect(await database.rows(`SELECT id FROM mailbox_connection`)).toEqual(
      [],
    );
  });

  it("learns an Outlook mailbox's address from Graph", async () => {
    stubProviders({
      "graph.microsoft.com/v1.0/me": () => ({
        mail: null,
        userPrincipalName: "Bo@Contoso.com",
      }),
    });

    expect(await ConnectionService.completeConnect(BO, "microsoft")).toEqual({
      ok: true,
    });
    expect(gateway.calls[0]?.provider).toBe("microsoft-365");
    expect(
      await database.rows(`SELECT account_email FROM mailbox_connection`),
    ).toEqual([{ account_email: "bo@contoso.com" }]);
    expect(
      await database.rows(`SELECT source, auto_create FROM mailbox_sync`),
    ).toEqual([{ source: "outlook", auto_create: 0 }]);
  });

  it("refuses a mailbox that isn't at the member's sign-in address", async () => {
    stubProviders({
      [GMAIL_PROFILE]: () => ({
        emailAddress: "ana.lovelace@gmail.com",
        historyId: "1",
      }),
      [PRIMARY_CALENDAR]: () => ({ id: "ana.lovelace@gmail.com" }),
    });

    expect(await ConnectionService.completeConnect(ANA, "google")).toEqual({
      ok: false,
      error: "email_doesn't_match",
    });
    expect(await database.rows(`SELECT id FROM mailbox_connection`)).toEqual(
      [],
    );
    expect(await database.rows(`SELECT id FROM mailbox_sync`)).toEqual([]);
  });

  it("asks for a reconnect once the gateway no longer holds the connection", async () => {
    await seedMailbox({
      ...ANA,
      provider: "google",
      accountEmail: "ana@acme.com",
      sources: ["gmail"],
    });
    const google = async () =>
      (await ConnectionService.status({ ...ANA, role: "member" })).providers[0]
        ?.connection?.needsReconnect;

    expect(await google()).toBe(false);
    gateway.setStatusConnection(null);
    expect(await google()).toBe(true);
  });

  it("stops capture on disconnect, keeping what was captured, with no call to the provider", async () => {
    await seedMailbox({
      ...ANA,
      provider: "google",
      accountEmail: "ana@acme.com",
      sources: ["gmail", "calendar"],
    });
    const fetched = stubProviders({});

    await ConnectionService.disconnect(ANA, "google");
    expect(fetched).toEqual([]);
    expect(gateway.calls).toEqual([]);
    expect(await database.rows(`SELECT id FROM mailbox_connection`)).toEqual(
      [],
    );
    expect(await database.rows(`SELECT id FROM mailbox_sync`)).toEqual([]);
  });
});
