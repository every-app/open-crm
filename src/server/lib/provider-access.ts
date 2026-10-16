import {
  ConfigurationError,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getWorkersEnv } from "@/server/lib/runtime-env";

// How the CRM reaches Context.dev, the one API it calls with a key. The Every
// App gateway holds the key: calls go over the gateway's binding, which puts
// the key on them, so the deployment needs no key of its own
// (docs/maintainers/every-app.md). Each call says whose it is: the request's
// identity while serving one, else the organization the work is for
// (gateway-attribution.ts). In local dev, with no binding, the SDK uses
// CONTEXT_API_KEY from .dev.vars.

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/**
 * A fetch that reaches Context.dev authenticated, or null when the gateway
 * (or, in dev, .dev.vars) has no key. Its calls are the forOrganization
 * scope's, or the served request's.
 */
export async function getContextFetch(): Promise<typeof fetch | null> {
  const env = await gatewayEnv();
  try {
    return integrationFetch({
      env,
      provider: "context",
      for: gatewayCallFor(env),
    });
  } catch (error) {
    // No gateway binding (and in local dev, no key in .dev.vars). A call that
    // says nobody's (AttributionError) is a bug, so it is thrown.
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

/**
 * Whether Context.dev calls would go through, without making one. The gateway
 * answers this for no organization in particular, so it needs none. The agent
 * reads it at the start of every session and plans around what it has.
 */
export async function hasContextAccess(): Promise<boolean> {
  try {
    const status = await integrationStatus({
      env: await gatewayEnv(),
      provider: "context",
    });
    return status.ready;
  } catch (error) {
    if (error instanceof ConfigurationError) return false;
    throw error;
  }
}
