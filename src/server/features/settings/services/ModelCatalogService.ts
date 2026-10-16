import { sortBy } from "remeda";
import { z } from "zod";

// The models the research agent can run on: OpenRouter's public catalog
// (no key), keeping the models that call tools, since the agent works
// through tools. Workers can't share a pending fetch across requests, so the
// isolate keeps the parsed list, not a promise, for a little while.

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_TTL_MS = 30 * 60_000;
const CATALOG_TIMEOUT_MS = 5_000;

export type CatalogModel = {
  id: string;
  name: string;
  /** The model's maker, from its id ("openai" in "openai/gpt-5"). */
  provider: string;
  contextWindowTokens: number;
  /** USD per token, as OpenRouter prices them; null when it doesn't say. */
  pricing: { input: number; output: number } | null;
};

// OpenRouter prices are decimal strings in USD per token.
const price = z.coerce.number().nonnegative().nullable().catch(null);

const openRouterModel = z.object({
  id: z.string().min(1),
  name: z.string().catch(""),
  context_length: z.number().positive().nullable().catch(null),
  top_provider: z
    .object({
      context_length: z.number().positive().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  pricing: z
    .object({ prompt: price, completion: price })
    .nullable()
    .catch(null),
  supported_parameters: z.array(z.string()).catch([]),
});

const openRouterCatalog = z
  .object({ data: z.array(z.unknown()).catch([]) })
  .catch({ data: [] });

function toCatalogModel(
  model: z.infer<typeof openRouterModel>,
): CatalogModel | null {
  const contextWindowTokens =
    model.context_length ?? model.top_provider?.context_length ?? null;
  if (!model.supported_parameters.includes("tools") || !contextWindowTokens) {
    return null;
  }
  const input = model.pricing?.prompt ?? null;
  const output = model.pricing?.completion ?? null;
  return {
    id: model.id,
    name: model.name || model.id,
    provider: model.id.split("/")[0] ?? model.id,
    contextWindowTokens,
    pricing: input !== null && output !== null ? { input, output } : null,
  };
}

let cached: { models: CatalogModel[]; fetchedAt: number } | null = null;

/** The tool-using models, by maker then name; null when OpenRouter can't be reached. */
async function models(): Promise<CatalogModel[] | null> {
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    return cached.models;
  }
  const fetched = await fetchCatalog();
  if (fetched) cached = { models: fetched, fetchedAt: Date.now() };
  return fetched;
}

async function find(id: string): Promise<CatalogModel | null> {
  return (await models())?.find((model) => model.id === id) ?? null;
}

async function fetchCatalog(): Promise<CatalogModel[] | null> {
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn("[settings] model catalog request failed", {
        status: response.status,
      });
      return null;
    }
    const body = openRouterCatalog.parse(await response.json());
    const catalog = body.data.flatMap((entry) => {
      const parsed = openRouterModel.safeParse(entry);
      const model = parsed.success ? toCatalogModel(parsed.data) : null;
      return model ? [model] : [];
    });
    return sortBy(
      catalog,
      (model) => model.provider,
      (model) => model.name,
    );
  } catch (error) {
    console.warn("[settings] model catalog unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const ModelCatalogService = {
  models,
  find,
};
