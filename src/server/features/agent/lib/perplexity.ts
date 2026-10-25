import { GATEWAY_ERROR_HEADER } from "@every-app/sdk/internal";
import { ConfigurationError } from "@every-app/sdk/server";
import { APICallError, generateText } from "ai";
import { z } from "zod";
import { getGatewayFetch } from "@/server/lib/gateway-ai";
import {
  openRouterProvider,
  WEB_RESEARCH_MODEL,
} from "@/server/lib/openrouter";
import { getWorkersEnv } from "@/server/lib/runtime-env";

// Cited web research on Perplexity's Sonar models, ported from the CRM's
// lib/perplexity.ts. The CRM called Perplexity with its own key; here the call
// goes to the same models through the Every App gateway's OpenRouter proxy,
// which holds the key and counts the call against the session's organization.
// OpenRouter is optional on the gateway (the agent's own model is the
// gateway's default, which may be another provider), so web research says
// where it is used when the gateway holds no OpenRouter key.
// An answer is only as good as its citations, so they are kept whichever way
// they come back: as OpenRouter's url_citation annotations (the AI SDK's
// sources) or as Perplexity's own citations list.

const TIMEOUT_MS = 45_000;

/** Sonar Pro reads more sources: slower, for a prep brief. */
const DEEP_RESEARCH_MODEL = "perplexity/sonar-pro";

type Answer = { text: string; citations: string[] };

type Outcome = { ok: true; data: Answer } | { ok: false; reason: string };

type AskOptions = {
  deep?: boolean;
  /** Search only these sites (OpenRouter's web plugin, `include_domains`). */
  domains?: string[];
  system?: string;
};

/** One cited question to Sonar. */
export type Ask = (question: string, options?: AskOptions) => Promise<Outcome>;

/**
 * What a web research call answers when the gateway (or, in local dev,
 * .dev.vars) holds no OpenRouter key: it names the key and the command, and
 * tells the agent not to try again.
 */
export const NO_OPENROUTER_KEY =
  "Web research is unavailable: this Every App gateway holds no OpenRouter key (an owner or admin runs: pnpm everyapp secret set OPENROUTER_API_KEY; in local development, put OPENROUTER_API_KEY in .dev.vars). This is not a failure and retrying will not help — use what the CRM already knows, and say in your write-up what you could not check.";

/**
 * The gateway has no status route for an AI provider, only refusals, so a
 * refusal for want of the OpenRouter key is remembered for a while
 * (per isolate: the gateway, and so its key, is the install's): web research
 * then reports itself missing before any budget is spent, and the agent's
 * capabilities leave it out. A key set later is picked up once this lapses.
 */
const REFUSAL_FRESH_MS = 10 * 60_000;
let refusedAt: number | null = null;

function recentlyRefused(): boolean {
  return refusedAt !== null && Date.now() - refusedAt < REFUSAL_FRESH_MS;
}

/** Whether web research would go through, as far as the CRM can tell without a call. */
export function webResearchAvailable(
  env: object,
  organizationId?: string,
): boolean {
  return !recentlyRefused() && getGatewayFetch(env, organizationId) !== null;
}

/**
 * The gateway's fetch when web research would go through (the gateway, or in
 * local dev .dev.vars, has a way to OpenRouter, and it hasn't refused lately
 * for want of its key), else null. Checked before any budget is spent: a
 * missing key is a missing source, never a charge.
 */
export async function webResearchAccess(): Promise<typeof fetch | null> {
  try {
    if (recentlyRefused()) return null;
    return getGatewayFetch((await getWorkersEnv()) ?? {});
  } catch (error) {
    console.warn("[agent] could not check web research", error);
    return null;
  }
}

/**
 * Whether `error` says OpenRouter isn't set up: the gateway's
 * `ai_provider_not_configured`, or in local dev the SDK's "Set
 * OPENROUTER_API_KEY in .dev.vars".
 */
function openRouterMissing(error: unknown): boolean {
  if (error instanceof ConfigurationError) return true;
  return (
    APICallError.isInstance(error) &&
    error.responseHeaders?.[GATEWAY_ERROR_HEADER] ===
      "ai_provider_not_configured"
  );
}

const perplexityCitations = z
  .object({
    citations: z.array(z.string()).catch([]),
    search_results: z
      .array(z.object({ url: z.string() }).nullable().catch(null))
      .catch([]),
  })
  .catch({ citations: [], search_results: [] });

/** Asks Sonar over `research` (webResearchAccess). Never throws. */
export function asker(research: typeof fetch): Ask {
  return async (question, options = {}) => {
    try {
      const result = await generateText({
        model: openRouterProvider(research)(
          options.deep ? DEEP_RESEARCH_MODEL : WEB_RESEARCH_MODEL,
          options.domains
            ? {
                extraBody: {
                  plugins: [{ id: "web", include_domains: options.domains }],
                },
              }
            : {},
        ),
        system: options.system,
        prompt: question,
        // A failed search is reported, not paid for again.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = result.text.trim();
      if (!text) return { ok: false, reason: "Empty answer." };
      const raw = perplexityCitations.parse(result.response.body);
      const citations = [
        ...new Set([
          ...result.sources.flatMap((source) =>
            source.sourceType === "url" ? [source.url] : [],
          ),
          ...raw.citations,
          ...raw.search_results.flatMap((found) => (found ? [found.url] : [])),
        ]),
      ];
      refusedAt = null;
      return { ok: true, data: { text, citations } };
    } catch (error) {
      if (openRouterMissing(error)) {
        refusedAt = Date.now();
        return { ok: false, reason: NO_OPENROUTER_KEY };
      }
      return { ok: false, reason: describe(error) };
    }
  };
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `Timed out after ${TIMEOUT_MS}ms.`;
  }
  return error instanceof Error ? error.message : String(error);
}
