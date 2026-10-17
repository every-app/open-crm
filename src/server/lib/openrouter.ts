import {
  ConfigurationError,
  createGatewayFetch,
  type GatewayFetchEnv,
} from "@every-app/sdk/server";
import {
  createOpenRouter,
  type LanguageModelV3,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";

/**
 * How the CRM reaches OpenRouter: through the Every App gateway's AI proxy,
 * which holds the key. The proxy's host is a placeholder the binding never
 * resolves. In local dev, with no gateway binding, the SDK calls OpenRouter
 * with OPENROUTER_API_KEY from .dev.vars instead.
 */
const GATEWAY_BASE_URL =
  "https://every-app-gateway.invalid/api/ai/openrouter/api/v1";

/**
 * The research agent's default model: deliberately not a frontier model. The
 * evidence ledger, not the model's judgement, decides what reaches a record,
 * so a fast, cheap model does the agent's work. A workspace picks another on
 * Settings → General.
 */
export const DEFAULT_AGENT_MODEL = {
  id: "minimax/minimax-m3",
  contextWindowTokens: 200_000,
} as const;

/** Perplexity's search model, for cited web research (research_person). */
export const WEB_RESEARCH_MODEL = "perplexity/sonar";

/**
 * The gateway's AI proxy fetch, its calls for `organizationId` (else the
 * forOrganization scope, or the request being served; gateway-attribution.ts),
 * or null without the gateway binding (and, in dev, without a local key).
 */
export function getOpenRouterFetch(
  env: object,
  organizationId?: string,
): typeof fetch | null {
  try {
    return createGatewayFetch({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createGatewayFetch reads only the binding, the shared flag and dev keys, each checked before use
      env: env as GatewayFetchEnv,
      for: gatewayCallFor(env, organizationId),
    });
  } catch (error) {
    // No gateway binding (and no local key in dev). A call that says nobody's
    // (AttributionError) is a bug, so it is thrown.
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

/** The OpenRouter provider over a gateway fetch. */
export function openRouterProvider(
  gatewayFetch: typeof fetch,
): OpenRouterProvider {
  return createOpenRouter({
    apiKey: "gateway-managed",
    baseURL: GATEWAY_BASE_URL,
    fetch: gatewayFetch,
  });
}

/**
 * The AI SDK model for `modelId` over `gatewayFetch`. `usage: { include: true }`
 * turns on OpenRouter usage accounting so each response carries its real USD
 * cost (providerMetadata.openrouter.usage.cost), which the agent's audit
 * records per session.
 */
export function buildAgentModel(
  gatewayFetch: typeof fetch,
  modelId: string = DEFAULT_AGENT_MODEL.id,
): LanguageModelV3 {
  const openrouter = openRouterProvider(gatewayFetch);
  if (modelId === DEFAULT_AGENT_MODEL.id) {
    // As OpenSEO routes MiniMax M3: Zero-Data-Retention endpoints only, with
    // fallbacks on, since pinning one provider turned an upstream rate limit
    // into an outage there.
    return openrouter(modelId, {
      usage: { include: true },
      reasoning: { effort: "medium" },
      provider: {
        order: ["together", "atlas-cloud/fp8"],
        zdr: true,
        allow_fallbacks: true,
      },
    });
  }
  return openrouter(modelId, { usage: { include: true } });
}
