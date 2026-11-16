import {
  ConfigurationError,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import type {
  EnrichmentProvider,
  EnrichmentProviderStatus,
} from "@/shared/enrichment";

// How the CRM reaches its enrichment providers. The Every App gateway holds
// each key and puts it on the call, so the CRM never sees one; each call is
// the member's who asked (gateway-attribution.ts). In local dev, with no
// gateway, the SDK uses CONTEXT_API_KEY and TREG_API_TOKEN from .dev.vars.

export type ProviderFetch = typeof fetch;

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/** A fetch that reaches `provider` with its key, or null when there is none. */
export async function providerFetch(
  provider: EnrichmentProvider,
): Promise<ProviderFetch | null> {
  const env = await gatewayEnv();
  try {
    return integrationFetch({ env, provider, for: gatewayCallFor(env) });
  } catch (error) {
    // No gateway binding and, in local dev, no key in .dev.vars.
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

/** Whether lookups with `provider` would go through, and what is missing when not. */
export async function providerStatus(
  provider: EnrichmentProvider,
): Promise<EnrichmentProviderStatus> {
  try {
    const env = await gatewayEnv();
    const status = await integrationStatus({
      env,
      provider,
      for: gatewayCallFor(env) ?? { background: true },
    });
    return {
      provider,
      ready: status.ready,
      setup: status.ready ? null : (status.setup ?? null),
      command: status.ready ? null : (status.command ?? null),
    };
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    return { provider, ready: false, setup: error.message, command: null };
  }
}
