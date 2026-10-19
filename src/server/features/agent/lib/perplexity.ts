import { generateText } from "ai";
import { z } from "zod";
import { reportSpend } from "@/server/billing/spendSink";
import { openRouterCostUsd } from "@/server/lib/chatAgent";
import {
  getOpenRouterFetch,
  openRouterProvider,
  WEB_RESEARCH_MODEL,
} from "@/server/lib/openrouter";
import { getWorkersEnv } from "@/server/lib/runtime-env";

// Cited web research on Perplexity's Sonar models, ported from the CRM's
// lib/perplexity.ts. The CRM called Perplexity with its own key; here the call
// goes to the same models through the Every App gateway's OpenRouter proxy,
// which holds the key and counts the call against the session's organization.
// Each search reports its OpenRouter cost (usage accounting) to the session's
// running total (billing/spendSink.ts).
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
 * The gateway's OpenRouter fetch when web research would go through (the
 * gateway, or in local dev .dev.vars, holds a key), else null. Checked before
 * any budget is spent: a missing key is a missing source, never a charge.
 */
export async function webResearchAccess(): Promise<typeof fetch | null> {
  try {
    return getOpenRouterFetch((await getWorkersEnv()) ?? {});
  } catch (error) {
    console.warn("[agent] could not check web research", error);
    return null;
  }
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
          {
            usage: { include: true },
            ...(options.domains
              ? {
                  extraBody: {
                    plugins: [{ id: "web", include_domains: options.domains }],
                  },
                }
              : {}),
          },
        ),
        system: options.system,
        prompt: question,
        // A failed search is reported, not paid for again.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      reportSpend({
        provider: "openrouter",
        creditFeature: "crm_agent",
        operation: "web_research",
        costUsd: openRouterCostUsd(result),
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
      return { ok: true, data: { text, citations } };
    } catch (error) {
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
