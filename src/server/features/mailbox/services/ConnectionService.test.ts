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
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
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

/** The provider sending `member` back to the callback with `query`. */
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

    it("refuses to start a connect without the key its tokens are encrypted under", async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });

      await expect(
        ConnectionService.startConnect(ANA, "google", ORIGIN),
      ).rejects.toThrow("TOKEN_ENCRYPTION_KEY");
      expect(await database.rows(`SELECT id FROM oauth_state`)).toEqual([]);
    });

    it("offers a Microsoft member's organization its admin consent when it refused theirs", async () => {
      const state = async () =>
        new URL(
          (await ConnectionService.startConnect(BO, "microsoft", ORIGIN)).url,
        ).searchParams.get("state") ?? "";
      gateway.answerTokens(() =>
        json(
          {
            error: "invalid_grant",
            error_description:
              "AADSTS65001: The user or administrator has not consented to use the application.",
          },
          400,
        ),
      );

      expect(
        await connect(BO, "microsoft", {
          state: await state(),
          error: "consent_required",
        }),
      ).toEqual({ ok: false, error: "access_denied" });
      expect(
        await connect(BO, "microsoft", { state: await state(), code: "c" }),
      ).toEqual({ ok: false, error: "access_denied" });
      const { providers } = await ConnectionService.status(
        { ...BO, role: "member" },
        ORIGIN,
      );
      const consent = new URL(
        providers.find((entry) => entry.provider === "microsoft")
          ?.adminConsentUrl ?? "",
      );
      expect(`${consent.origin}${consent.pathname}`).toBe(
        "https://login.microsoftonline.com/contoso.com/v2.0/adminconsent",
      );
      expect(Object.fromEntries(consent.searchParams)).toEqual({
        client_id: "client-microsoft-365",
        scope:
          "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read",
        redirect_uri: `${ORIGIN}/integrations/microsoft/callback`,
      });
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
        await ConnectionRepository.findWithTokens(
          BO.organizationId,
          BO.userId,
          "microsoft",
        ),
      ).toMatchObject({
        accountEmail: "bo@contoso.com",
        refreshToken: "refresh-1",
      });
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

    it("leaves Google's grant while another organization's connection uses the same account, which would lose it too", async () => {
      // Ana's Google account, connected in both organizations (the gateway's
      // one client), and Bo's own in org_b.
      const anaInB = { organizationId: "org_b", userId: "user_a" };
      for (const member of [ANA, anaInB]) {
        await seedMailbox({
          ...member,
          provider: "google",
          accountEmail: "ana@acme.com",
          sources: ["gmail"],
        });
      }
      await seedMailbox({
        ...BO,
        provider: "google",
        accountEmail: "bo@contoso.com",
        sources: ["gmail"],
      });
      const revoked: string[] = [];
      stubProviders({
        "oauth2.googleapis.com/revoke": () => {
          revoked.push("call");
          return new Response(null, { status: 200 });
        },
      });

      await ConnectionService.disconnect(ANA, "google");
      expect(revoked).toEqual([]);
      expect(
        await database.rows(
          `SELECT organization_id, user_id FROM mailbox_connection ORDER BY user_id`,
        ),
      ).toEqual([
        { organization_id: "org_b", user_id: "user_a" },
        { organization_id: "org_b", user_id: "user_b" },
      ]);

      // The account's last connection withdraws the grant; Bo's own account
      // doesn't hold it back.
      await ConnectionService.disconnect(anaInB, "google");
      expect(revoked).toHaveLength(1);
    });
  });
}
