import { AsyncLocalStorage } from "node:async_hooks";
import { IDENTITY_HEADER } from "@every-app/sdk/internal";
import type { EveryAppUser, GatewayCallFor } from "@every-app/sdk/server";
import { decodeJwt } from "jose";

// Whom the CRM's calls through the Every App gateway are for. The gateway
// counts each Context or OpenRouter call against an organization, and a
// first-party deployment serves every organization from one Worker
// (EVERYAPP_SHARED=1), so every call has to say whose it is. The SDK takes
// that as `for` (packages/sdk/README.md, "Whom a call is for"):
//
// - While the CRM serves a request the gateway forwarded, the request's
//   signed identity is forwarded with the call (`for: request`), so the call
//   is that person's, in their organization. src/server.ts and
//   src/server/everyapp/tools.ts open that scope with serveEveryAppRequest.
// - Work no request started (the agent's sessions, the minute cron) names the
//   organization that owns it with forOrganization(), which sends it as
//   `x-everyapp-org` (`for: { background: true, organizationId }`).
//
// The CRM's organization id is the gateway's in both shapes (first party and
// fork), so a named organization goes to the gateway as it is. A named
// organization inside a request must be the request's, or the call is refused
// here before it leaves. A call that says nobody's throws the SDK's
// AttributionError in a shared Worker, so a path this misses fails closed
// instead of spending without an organization.

interface ServedRequest {
  request: Request;
  /** The gateway organization of the request's verified identity. */
  organizationId: string;
  /** When the forwarded identity expires (epoch ms). */
  expiresAt: number;
}

const servedRequests = new AsyncLocalStorage<ServedRequest>();
const namedOrganizations = new AsyncLocalStorage<string>();

// A forwarded identity lives 120 seconds. One this close to its expiry could
// expire before the gateway checks it (a 401 the call can't recover from), so
// work still running then goes on as its organization's background work.
const IDENTITY_EXPIRY_MARGIN_MS = 15_000;

function identityExpiry(request: Request): number {
  const token = request.headers.get(IDENTITY_HEADER);
  if (!token) return 0;
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Serve `fn` for a request the gateway forwarded with `user`'s verified
 * identity: gateway calls made while it runs forward that identity. A request
 * with no user (a public route) forwards nothing.
 */
export function serveEveryAppRequest<T>(
  request: Request,
  user: EveryAppUser | null,
  fn: () => T,
): T {
  if (!user) return fn();
  return servedRequests.run(
    {
      request,
      organizationId: user.orgId,
      expiresAt: identityExpiry(request),
    },
    fn,
  );
}

/**
 * Run `fn` as work for `organizationId`: every gateway call made inside is
 * that organization's.
 */
export function forOrganization<T>(organizationId: string, fn: () => T): T {
  return namedOrganizations.run(organizationId, fn);
}

/**
 * The SDK's `for` for a gateway call made now: the served request while its
 * identity is good, else the named organization (`organizationId`, or the
 * forOrganization scope), else, for work a request started that outlived
 * its identity, the request's organization. Undefined when nothing names
 * one, which a shared Worker's SDK refuses.
 */
export function gatewayCallFor(
  _env: object,
  organizationId: string | undefined = namedOrganizations.getStore(),
): GatewayCallFor | undefined {
  const named = organizationId || undefined;
  const served = servedRequests.getStore();
  if (served && named && named !== served.organizationId) {
    throw new Error(
      `A gateway call for organization ${named} was made while serving a request of organization ${served.organizationId}.`,
    );
  }
  if (served && Date.now() < served.expiresAt - IDENTITY_EXPIRY_MARGIN_MS) {
    return served.request;
  }
  const background = named ?? served?.organizationId;
  return background
    ? { background: true, organizationId: background }
    : undefined;
}
