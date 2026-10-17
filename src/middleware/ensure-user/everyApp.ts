import { env } from "cloudflare:workers";
import {
  ConfigurationError,
  getEveryAppUser,
  hasScope,
  type EveryAppUser,
} from "@every-app/sdk/server";
import { ensureEveryAppMembership } from "@/server/auth/delegated-organization";
import { AppError } from "@/server/lib/errors";
import { ensureUserRecord } from "./delegated";
import type { EnsuredUserContext } from "./types";

// The gateway's organization roles are the CRM's: owners and admins manage
// fields, settings and everyone's records, members work the pipeline.
// Anything else gets the least.
const ROLES = new Set(["owner", "admin", "member"]);

// The Every App gateway signs in the person, checks they may open the CRM,
// and signs their identity onto every request it forwards. Two shapes, one
// path (docs/maintainers/every-app.md):
//
// - EVERY_APP_ORG_ID set (a fork: a self-hosted gateway's CRM, or one
//   organization's own copy): a token for any other organization is refused.
// - EVERY_APP_ORG_ID unset (first party, one Worker for every organization):
//   any organization the gateway lets in.
//
// Either way the token's organization is the CRM's organization, created on
// first use with the same id, so each organization's records stay its own,
// and the organization and role come from the signed token on this request,
// never from a member row: when the gateway removes a member, it stops
// signing tokens for them and nothing in the CRM still lets them in.
export async function resolveEveryAppContext(
  headers: Headers,
): Promise<EnsuredUserContext> {
  let user: EveryAppUser | null;
  try {
    // The SDK reads the identity headers only; the URL is never used.
    user = await getEveryAppUser(
      new Request("https://crm.invalid/", { headers }),
      env,
    );
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new AppError(
        "AUTH_CONFIG_MISSING",
        `${error.message} Deploy the CRM to the gateway with \`everyapp deploy\`, or run it locally with \`pnpm dev\`.`,
      );
    }
    console.error("Every App identity verification failed:", error);
    throw new AppError("UNAUTHENTICATED");
  }
  if (!user) throw new AppError("UNAUTHENTICATED");
  // A personal access token made with scopes (`api:read`) is limited to what
  // the REST API lets those scopes do (src/server/api/handler.ts). The app's
  // own server functions and the agent's chats assume everything a signed-in
  // member may do, so they take only a credential that holds all of it.
  if (!hasScope(user, "*")) throw new AppError("FORBIDDEN");
  return resolveEveryAppUserContext(user);
}

/** The CRM user and organization for a verified gateway identity. */
export async function resolveEveryAppUserContext(
  user: EveryAppUser,
): Promise<EnsuredUserContext> {
  const pinnedOrganizationId = env.EVERY_APP_ORG_ID;
  // The deploy pins a fork to its organization. The audience already names
  // this app; this keeps another organization's install of it out.
  if (pinnedOrganizationId && user.orgId !== pinnedOrganizationId) {
    throw new AppError("UNAUTHENTICATED");
  }
  // The gateway always names an organization; a token without one has no
  // workspace to open.
  if (!user.orgId) throw new AppError("UNAUTHENTICATED");
  const role = ROLES.has(user.orgRole) ? user.orgRole : "member";
  const userEmail = await ensureUserRecord(user.id, user.email);
  const organizationId = await ensureEveryAppMembership({
    organizationId: user.orgId,
    userId: user.id,
    role,
  });
  return {
    userId: user.id,
    userEmail,
    organizationId,
    role,
  };
}
