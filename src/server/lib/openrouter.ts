import {
  ConfigurationError,
  createGatewayFetch,
  type GatewayFetchEnv,
} from "@every-app/sdk/server";
import {
  createOpenRouter,
  type LanguageModelV3,
  type OpenRouterChatSettings,
} from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * How the CRM reaches OpenRouter: through the Every App gateway's AI proxy,
 * which holds the key. The proxy's host is a placeholder the binding never
 * resolves. In local dev, with no gateway binding, the SDK calls OpenRouter
 * with OPENROUTER_API_KEY from .dev.vars instead.
 */
const GATEWAY_BASE_URL =
  "https://every-app-gateway.invalid/api/ai/openrouter/api/v1";

/**
 * The agent's model: GPT-6 Luna, set up as OpenSEO's SAM runs Luna. A
 * self-hosted copy picks another OpenRouter model with OPENROUTER_MODEL;
 * nobody picks one in the app.
 */
export const DEFAULT_AGENT_MODEL = "openai/gpt-6-luna";

// OpenSEO's previous default: reachable through OPENROUTER_MODEL, and the
// fallback where OpenAI is blocked. Its routing needs the ZDR and provider
// tuning below.
const MINIMAX_M3 = "minimax/minimax-m3";

/**
 * How hard the model reasons, as OpenSEO splits it: a person's chat turn at
 * "max", background work (research, team agent runs, summaries) at "low".
 */
export type ReasoningEffort = "max" | "low";

/** The model the agent runs on: OPENROUTER_MODEL, or Luna. */
export async function agentModelId(): Promise<string> {
  return (await getOptionalEnvValue("OPENROUTER_MODEL")) ?? DEFAULT_AGENT_MODEL;
}

// OpenRouter rejects OpenAI models for requests from these countries ("This
// model is not available in your region"). Durable Objects run near the
// person who opened them, outside the Worker's placement.
const OPENAI_BLOCKED_COUNTRIES = [
  "CN",
  "HK",
  "MO",
  "RU",
  "BY",
  "IR",
  "KP",
  "SY",
  "CU",
];

// The country this isolate's requests leave from. An isolate stays in one
// location, so one lookup serves its lifetime. Caches the value, not the
// promise: Workers can't share a pending fetch across requests. Fails open: a
// slow or failed lookup leaves the country unknown, and calls stay on OpenAI.
let egressCountry: string | undefined;
async function openAiBlockedHere(): Promise<boolean> {
  egressCountry ??= await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
    signal: AbortSignal.timeout(2000),
  })
    .then((response) => response.text())
    .then((trace) => /^loc=(\w+)$/m.exec(trace)?.[1] ?? "")
    .catch(() => "");
  return OPENAI_BLOCKED_COUNTRIES.includes(egressCountry);
}

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

/**
 * How every model call is routed, whatever else it asks: only to providers
 * that keep no copy of the prompt (OpenRouter's Zero Data Retention
 * endpoints) and collect no data from it, since prompts carry captured mail.
 * Every model the CRM calls has such endpoints: GPT-6 Luna on Azure, MiniMax
 * M3 on Together, Sonar on Perplexity.
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

/**
 * The AI SDK model for `modelId` over `gatewayFetch` at `effort`, as OpenSEO
 * builds SAM's (buildChatAgentModel). `usage: { include: true }` turns on
 * OpenRouter usage accounting so each response carries its real USD cost
 * (providerMetadata.openrouter.usage.cost). "max" is valid at the OpenRouter
 * API for GPT-6 Luna (its supported_efforts) but missing from the SDK's effort
 * union, so the reasoning config rides in `extraBody`; reasoning tokens are
 * billed as output tokens, which the usage accounting captures.
 */
export function buildAgentModel(
  gatewayFetch: typeof fetch,
  modelId: string,
  effort: ReasoningEffort,
): LanguageModelV3 {
  const openrouter = openRouterProvider(gatewayFetch);
  const primary = openRouterModel(openrouter, modelId, effort);
  if (!modelId.startsWith("openai/")) return primary;
  // Where OpenRouter would reject OpenAI, pick MiniMax M3 before the request.
  // The country lookup is async and getModel() is sync, so it runs per call.
  const fallback = openRouterModel(openrouter, MINIMAX_M3, effort);
  const pick = async () => ((await openAiBlockedHere()) ? fallback : primary);
  return wrapLanguageModel({
    model: primary,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ params }) => (await pick()).doGenerate(params),
      wrapStream: async ({ params }) => (await pick()).doStream(params),
    },
  });
}

function openRouterModel(
  openrouter: ReturnType<typeof openRouterProvider>,
  model: string,
  effort: ReasoningEffort,
): LanguageModelV3 {
  // MiniMax M3 (an OPENROUTER_MODEL override or the OpenAI fallback), routed
  // as OpenSEO routes it: Zero-Data-Retention endpoints only, Together then
  // Atlas Cloud, with fallbacks on, since pinning one provider turned an
  // upstream rate limit into an outage there. The explicit reasoning channel
  // keeps its trace out of the visible answer.
  if (model === MINIMAX_M3) {
    return openrouter(model, {
      usage: { include: true },
      reasoning: { effort: effort === "low" ? "low" : "medium" },
      provider: {
        order: ["together", "atlas-cloud/fp8"],
        allow_fallbacks: true,
      },
    });
  }
  return openrouter(model, {
    usage: { include: true },
    extraBody: { reasoning: { effort } },
  });
}
