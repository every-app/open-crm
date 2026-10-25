import {
  createOpenRouter,
  type LanguageModelV3,
  type OpenRouterChatSettings,
} from "@openrouter/ai-sdk-provider";

/**
 * How the CRM's web research reaches OpenRouter: through the Every App
 * gateway's AI proxy, pinned (`providers` in everyapp.config.ts, optional),
 * which holds the key. Only web research goes here (Perplexity's Sonar
 * models and OpenRouter's web plugin, lib/perplexity.ts); the agent's own
 * model is the gateway's default (gateway-ai.ts). The proxy's host is a
 * placeholder the binding never resolves. In local dev, with no gateway
 * binding, the SDK calls OpenRouter with OPENROUTER_API_KEY from .dev.vars.
 */
const GATEWAY_BASE_URL =
  "https://every-app-gateway.invalid/api/ai/openrouter/api/v1";

/** Perplexity's search model, for cited web research (research_person). */
export const WEB_RESEARCH_MODEL = "perplexity/sonar";

/**
 * How every web research call is routed, whatever else it asks: only to
 * providers that keep no copy of the prompt (OpenRouter's Zero Data
 * Retention endpoints) and collect no data from it. Sonar has such endpoints
 * on Perplexity.
 */
const PRIVATE_ROUTING = { data_collection: "deny", zdr: true } as const;

/**
 * OpenRouter's chat models over a gateway fetch: `modelId` with `settings`,
 * routed as PRIVATE_ROUTING says.
 */
export function openRouterProvider(gatewayFetch: typeof fetch) {
  const openrouter = createOpenRouter({
    apiKey: "gateway-managed",
    baseURL: GATEWAY_BASE_URL,
    fetch: gatewayFetch,
  });
  return (
    modelId: string,
    settings: OpenRouterChatSettings = {},
  ): LanguageModelV3 =>
    openrouter.chat(modelId, {
      ...settings,
      provider: { ...settings.provider, ...PRIVATE_ROUTING },
    });
}
