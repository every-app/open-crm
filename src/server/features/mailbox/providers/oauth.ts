import {
  ConfigurationError,
  gatewayRefusal,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { z } from "zod";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getOptionalEnvValue, getWorkersEnv } from "@/server/lib/runtime-env";
import { REQUESTED_SCOPES, type MailboxProvider } from "@/shared/mailbox";

// Google's and Microsoft's OAuth, with the client the Every App gateway
// holds (`google-workspace`, `microsoft-365`): the CRM builds the authorize
// URL from the client's public id and sends the code or refresh token to the
// provider's token endpoint through the gateway, which puts its client on the
// request. The CRM never sees a client secret and never sends a client id to
// the token endpoint. Agents can't mint tokens (the gateway refuses
// `integration_agent_not_allowed`); background refreshes name their
// organization (forOrganization → gatewayCallFor).

const CAPABILITY = {
  google: "google-workspace",
  microsoft: "microsoft-365",
} as const satisfies Record<MailboxProvider, string>;

/**
 * Microsoft's sign-in and token endpoints, on the tenant the CRM's
 * MICROSOFT_TENANT_ID names, as in the CRM: `common` (any work, school or
 * personal account) unless set. A client registered for one tenant answers
 * only on that tenant's path.
 */
async function microsoftEndpoints(): Promise<string> {
  const tenant = (await getOptionalEnvValue("MICROSOFT_TENANT_ID")) ?? "common";
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export async function authorizeUrl(provider: MailboxProvider): Promise<string> {
  return provider === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : `${await microsoftEndpoints()}/authorize`;
}

async function tokenUrl(provider: MailboxProvider): Promise<string> {
  return provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : `${await microsoftEndpoints()}/token`;
}

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** The gateway settings an operator sets for each provider's client. */
export const GATEWAY_SECRETS = {
  google: ["GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_SECRET"],
  microsoft: ["MICROSOFT_365_CLIENT_ID", "MICROSOFT_365_CLIENT_SECRET"],
} as const satisfies Record<MailboxProvider, readonly string[]>;

export const CALLBACK_PATH = {
  google: "/integrations/google/callback",
  microsoft: "/integrations/microsoft/callback",
} as const satisfies Record<MailboxProvider, string>;

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/** Whether the gateway holds the provider's client, and its public id. */
export async function clientStatus(
  provider: MailboxProvider,
): Promise<{ ready: boolean; clientId: string | null }> {
  try {
    const status = await integrationStatus({
      env: await gatewayEnv(),
      provider: CAPABILITY[provider],
    });
    return {
      ready: status.ready && Boolean(status.clientId),
      clientId: status.clientId ?? null,
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { ready: false, clientId: null };
    }
    throw error;
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

type TokenSet = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string | null;
  scope: string | null;
};

type TokenOutcome =
  | { ok: true; tokens: TokenSet }
  // The provider refused the code or the refresh token: connect again.
  | { ok: false; kind: "invalid_grant"; reason: string }
  | { ok: false; kind: "failed"; reason: string };

const LABEL = { google: "Google", microsoft: "Microsoft" } as const;

/**
 * A call to the provider's token endpoint through the gateway: exchanging a
 * code (`authorization_code`) or refreshing (`refresh_token`). Never logs or
 * returns the request or the answer's tokens in a reason.
 */
export async function tokenRequest(
  provider: MailboxProvider,
  params: Record<string, string>,
): Promise<TokenOutcome> {
  const env = await gatewayEnv();
  let response: Response;
  try {
    const call = integrationFetch({
      env,
      provider: CAPABILITY[provider],
      for: gatewayCallFor(env),
    });
    response = await call(await tokenUrl(provider), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        // Microsoft wants the scopes again on each leg.
        ...(provider === "microsoft"
          ? { scope: REQUESTED_SCOPES.microsoft.join(" ") }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return {
        ok: false,
        kind: "failed",
        reason: `${LABEL[provider]} isn't set up on this Every App gateway.`,
      };
    }
    return {
      ok: false,
      kind: "failed",
      reason: `${LABEL[provider]}'s token endpoint could not be reached.`,
    };
  }

  const refused = await gatewayRefusal(response);
  if (refused) {
    console.warn("[mailbox] the gateway refused a token call", {
      provider,
      code: refused.code,
    });
    return { ok: false, kind: "failed", reason: refused.message };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .catch({})
      .parse(body);
    const reason =
      error.error_description?.split("\n")[0] ??
      error.error ??
      `${LABEL[provider]} answered HTTP ${response.status}.`;
    return {
      ok: false,
      kind: error.error === "invalid_grant" ? "invalid_grant" : "failed",
      reason,
    };
  }

  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "failed",
      reason: `${LABEL[provider]} answered without an access token.`,
    };
  }
  const tokens = parsed.data;
  return {
    ok: true,
    tokens: {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
    },
  };
}

/**
 * Withdraws a Google grant. Google answers 400 for a token already revoked
 * or expired, which leaves no live grant either way. No client is needed.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}
