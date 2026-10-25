import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  ConfigurationError,
  createGatewayFetch,
  type GatewayFetchEnv,
} from "@every-app/sdk/server";
import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * The research agent's model: the Every App gateway's default model
 * (`ai.chat` in everyapp.config.ts), OpenAI-shaped at
 * `/api/ai/default/v1/chat/completions`. The gateway's operator picks the
 * provider and the model (`everyapp ai default <provider>[/<model>]`; else
 * the first of OpenRouter, Workers AI, OpenAI, Anthropic, Groq, Mistral and
 * Gemini whose key it holds), so the CRM sends nothing one provider alone
 * understands. The host is a placeholder the binding never resolves. In
 * local dev, with no gateway binding, the SDK resolves the default on the
 * keys in .dev.vars.
 */
const DEFAULT_MODEL_BASE_URL =
  "https://every-app-gateway.invalid/api/ai/default/v1";

/** "default": the gateway puts its operator's model in. */
export const DEFAULT_AGENT_MODEL = "default";

/**
 * The model id the agent runs on: AGENT_MODEL (as the gateway's default
 * provider names it), or the operator's default.
 */
export async function agentModelId(): Promise<string> {
  return (await getOptionalEnvValue("AGENT_MODEL")) ?? DEFAULT_AGENT_MODEL;
}

/**
 * The gateway's refusals that mean the agent's model isn't set up: no
 * default model provider (`ai_default_not_configured`), or a pinned
 * provider's key missing (`ai_provider_not_configured`).
 */
export const MODEL_NOT_CONFIGURED: ReadonlySet<string> = new Set([
  "ai_default_not_configured",
  "ai_provider_not_configured",
]);

/**
 * The gateway's AI proxy fetch, its calls for `organizationId` (else the
 * forOrganization scope, or the request being served; gateway-attribution.ts),
 * or null without the gateway binding (and, in dev, without a local key).
 */
export function getGatewayFetch(
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

/**
 * The AI SDK model for `modelId` on the gateway's default route, over
 * `gatewayFetch`. Plain chat completions: no provider routing, usage
 * accounting or reasoning settings, which only OpenRouter reads. Streams ask
 * for their usage (`stream_options.include_usage`), which the session's
 * token limits count. The gateway counts the call's spend.
 */
export function buildAgentModel(
  gatewayFetch: typeof fetch,
  modelId: string,
): LanguageModelV3 {
  return createOpenAICompatible({
    name: "every-app-gateway",
    baseURL: DEFAULT_MODEL_BASE_URL,
    // The gateway holds the key; the SDK drops the Authorization header.
    apiKey: "gateway-managed",
    fetch: gatewayFetch,
    includeUsage: true,
  }).chatModel(modelId);
}
