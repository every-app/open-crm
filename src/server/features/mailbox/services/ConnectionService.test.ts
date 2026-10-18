import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { vi } from "vitest";

// Connecting a mailbox on both backends: the single-use state is a
// conditional update, the connection an upsert that keeps a refresh token.
const { testDb, gateway } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  const { createGateway } =
    await import("@/server/features/mailbox/mailboxTestSupport");
  return {
    testDb: await createDualDialectTestDb(),
    gateway: createGateway(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return testDb.modules.workers.env.DATABASE_PROVIDER;
    },
    EVERY_APP_GATEWAY: gateway.binding,
    EVERYAPP_SHARED: "1",
  },
  waitUntil: () => {},
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import {
  firstValue,
  json,
  stubProviders,
} from "@/server/features/mailbox/mailboxTestSupport";
import { seedMailbox } from "@/server/features/mailbox/mailboxTestSeeds";
import { forOrganization } from "@/server/lib/gateway-attribution";
import { ConnectionService } from "./ConnectionService";

const ORIGIN = "https://crm.example.com";
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

async function challengeOf(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString("base64url");
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`ConnectionService (${dialect})`, () => {
    const database = testDb.use(dialect);
    beforeEach(async () => {
      testDb.use(dialect);
      gateway.tokenCalls.length = 0;
      gateway.answerTokens(() =>
        json({ access_token: "fresh-access", expires_in: 3600 }),
      );
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    const connect = async (
      member: typeof ANA,
      provider: "google" | "microsoft",
      query: Record<string, string>,
    ) =>
      forOrganization(member.organizationId, () =>
        ConnectionService.completeConnect(
          member,
          provider,
          new URL(
            `${ORIGIN}/integrations/${provider}/callback?${new URLSearchParams(query).toString()}`,
          ),
        ),
      );

    it("sends the member to Google with the gateway's client, PKCE and a stored state", async () => {
      const { url } = await ConnectionService.startConnect(
        ANA,
        "google",
        ORIGIN,
      );
      const params = new URL(url).searchParams;
      const state = (column: string) =>
        firstValue(database.rows(`SELECT * FROM oauth_state`), column);

      expect(
        url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"),
      ).toBe(true);
      expect(Object.fromEntries(params)).toMatchObject({
        client_id: "client-google-workspace",
        redirect_uri: `${ORIGIN}/integrations/google/callback`,
        response_type: "code",
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        state: await state("id"),
        code_challenge_method: "S256",
        code_challenge: await challengeOf(String(await state("code_verifier"))),
      });
    });

    it("connects through the gateway with no client of its own, and starts only the sources granted", async () => {
      stubProviders({
        "www.googleapis.com/calendar/v3/calendars/primary": () => ({
          id: "Ana@Acme.com",
        }),
      });
      gateway.answerTokens(() =>
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        }),
      );
      const { url } = await ConnectionService.startConnect(
        ANA,
        "google",
        ORIGIN,
      );
      const state = new URL(url).searchParams.get("state") ?? "";

      expect(await connect(ANA, "google", { state, code: "the-code" })).toEqual(
        {
          ok: true,
        },
      );

      const [call] = gateway.tokenCalls;
      expect(call?.path).toBe(
        "/api/integrations/google-workspace/oauth2.googleapis.com/token",
      );
      expect(Object.fromEntries(call?.form ?? [])).toEqual({
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: `${ORIGIN}/integrations/google/callback`,
        code_verifier: await firstValue(
          database.rows(`SELECT code_verifier FROM oauth_state`),
          "code_verifier",
        ),
      });
      expect(call?.headers.get("x-everyapp-org")).toBe("org_a");

      const { providers } = await ConnectionService.status(
        { ...ANA, role: "member" },
        ORIGIN,
      );
      const google = providers.find((entry) => entry.provider === "google");
      expect(google?.connection).toMatchObject({
        accountEmail: "ana@acme.com",
        hasRefreshToken: true,
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
      // The state is spent.
      expect(await connect(ANA, "google", { state, code: "the-code" })).toEqual(
        {
          ok: false,
          error: "state_mismatch",
        },
      );
    });

    it("refuses a state another member started, and a denied consent stores nothing", async () => {
      const { url } = await ConnectionService.startConnect(
        BO,
        "microsoft",
        ORIGIN,
      );
      const state = new URL(url).searchParams.get("state") ?? "";
      expect(new URL(url).searchParams.get("prompt")).toBe("select_account");

      expect(await connect(ANA, "microsoft", { state, code: "x" })).toEqual({
        ok: false,
        error: "state_mismatch",
      });
      expect(
        await connect(BO, "microsoft", { state, error: "access_denied" }),
      ).toEqual({ ok: false, error: "access_denied" });
      expect(gateway.tokenCalls).toHaveLength(0);
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
      gateway.answerTokens(() =>
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope:
            "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
        }),
      );
      const { url } = await ConnectionService.startConnect(
        BO,
        "microsoft",
        ORIGIN,
      );
      const state = new URL(url).searchParams.get("state") ?? "";

      expect(await connect(BO, "microsoft", { state, code: "c" })).toEqual({
        ok: true,
      });
      expect(gateway.tokenCalls[0]?.form.get("scope")).toBe(
        "offline_access User.Read Mail.Read",
      );
      expect(
        await database.rows(
          `SELECT account_email, refresh_token FROM mailbox_connection`,
        ),
      ).toEqual([
        { account_email: "bo@contoso.com", refresh_token: "refresh-1" },
      ]);
      expect(
        await database.rows(`SELECT source, auto_create FROM mailbox_sync`),
      ).toEqual([
        { source: "outlook", auto_create: dialect === "sqlite" ? 0 : false },
      ]);
    });

    it("refuses a mailbox that isn't at the member's sign-in address", async () => {
      stubProviders({
        "www.googleapis.com/calendar/v3/calendars/primary": () => ({
          id: "ana.lovelace@gmail.com",
        }),
      });
      gateway.answerTokens(() =>
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        }),
      );
      const { url } = await ConnectionService.startConnect(
        ANA,
        "google",
        ORIGIN,
      );
      const state = new URL(url).searchParams.get("state") ?? "";

      expect(await connect(ANA, "google", { state, code: "c" })).toEqual({
        ok: false,
        error: "email_doesn't_match",
      });
      expect(await database.rows(`SELECT id FROM mailbox_connection`)).toEqual(
        [],
      );
      expect(await database.rows(`SELECT id FROM mailbox_sync`)).toEqual([]);
    });

    it("signs in and exchanges the code on the CRM's Microsoft tenant", async () => {
      vi.stubEnv("MICROSOFT_TENANT_ID", "contoso.onmicrosoft.com");
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });
      stubProviders({
        "graph.microsoft.com/v1.0/me": () => ({ mail: "bo@contoso.com" }),
      });
      const { url } = await ConnectionService.startConnect(
        BO,
        "microsoft",
        ORIGIN,
      );
      expect(
        url.startsWith(
          "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize?",
        ),
      ).toBe(true);

      const state = new URL(url).searchParams.get("state") ?? "";
      expect(await connect(BO, "microsoft", { state, code: "c" })).toEqual({
        ok: true,
      });
      expect(gateway.tokenCalls[0]?.path).toBe(
        "/api/integrations/microsoft-365/login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token",
      );
    });

    it("withdraws Google's grant before forgetting it, and keeps what was captured", async () => {
      await seedMailbox({
        ...ANA,
        provider: "google",
        accountEmail: "ana@acme.com",
        sources: ["gmail", "calendar"],
        refreshToken: "refresh-1",
      });
      let revokeStatus = 503;
      const revoked: string[] = [];
      stubProviders({
        "oauth2.googleapis.com/revoke": () => {
          revoked.push("call");
          return new Response(null, { status: revokeStatus });
        },
      });

      await expect(ConnectionService.disconnect(ANA, "google")).rejects.toThrow(
        "Google did not confirm",
      );
      expect(
        await database.rows(`SELECT id FROM mailbox_connection`),
      ).toHaveLength(1);

      revokeStatus = 200;
      await ConnectionService.disconnect(ANA, "google");
      expect(revoked).toHaveLength(2);
      expect(await database.rows(`SELECT id FROM mailbox_connection`)).toEqual(
        [],
      );
      expect(await database.rows(`SELECT id FROM mailbox_sync`)).toEqual([]);
    });
  });
}
