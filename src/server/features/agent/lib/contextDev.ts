import { gatewayRefusal } from "@every-app/sdk/server";
import { z } from "zod";
import { contextDevSpend } from "@/server/billing/contextDevPricing";
import { reportSpend } from "@/server/billing/spendSink";
import { personFromMatch, type PersonMatch } from "./people";

// The agent's Context.dev client: brand data by domain, a person read back
// from a profile URL or matched on the clues the CRM holds (their address,
// name and employer), and structured extraction from a site. Ported from the
// CRM's lib/context-dev.ts and lib/people.ts, which used the context.dev SDK;
// here the calls go to the REST API (https://api.context.dev/v1) over the
// gateway's fetch (getContextFetch()), which holds the key and attributes each
// call to the organization whose work it is. Answers are untrusted and parsed
// leniently: a field Context.dev leaves out is simply missing. Each answer's
// charge is reported to the work it ran in (billing/spendSink.ts).

const API = "https://api.context.dev/v1";
const TIMEOUT_MS = 60_000;

export type ContextFetch = typeof fetch;

const text = z.string().trim().min(1).nullable().catch(null);
const hex = z.object({ hex: text }).catch({ hex: null });

const brandSchema = z.object({
  title: text,
  description: text,
  slogan: text,
  email: text,
  phone: text,
  colors: z.array(hex).catch([]),
  logos: z
    .array(
      z
        .object({
          url: text,
          mode: text,
          type: text,
          colors: z.array(hex).catch([]),
        })
        .catch({ url: null, mode: null, type: null, colors: [] }),
    )
    .catch([]),
  socials: z
    .array(z.object({ type: text, url: text }).catch({ type: null, url: null }))
    .catch([]),
  address: z
    .object({ city: text, state_code: text, country: text, country_code: text })
    .nullable()
    .catch(null),
  industries: z
    .object({
      eic: z
        .array(
          z
            .object({ industry: text, subindustry: text })
            .catch({ industry: null, subindustry: null }),
        )
        .catch([]),
    })
    .nullable()
    .catch(null),
  links: z.object({ pricing: text, careers: text }).nullable().catch(null),
});

export type Brand = z.infer<typeof brandSchema>;

type LookupResult =
  | { outcome: "found"; brand: Brand; raw: unknown }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string; retryable: boolean };

type Answer =
  | { ok: true; body: unknown }
  | {
      ok: false;
      status: number;
      code: string | null;
      reason: string;
      refused: boolean;
    };

const errorBody = z
  .object({
    error_code: z.string().optional().catch(undefined),
    message: z.string().optional().catch(undefined),
  })
  .catch({});

async function post(
  contextFetch: ContextFetch,
  path: string,
  body: Record<string, unknown>,
): Promise<Answer> {
  let response: Response;
  try {
    response = await contextFetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        timeoutOpts: { milliseconds: TIMEOUT_MS, behavior: "fail" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS + 15_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: null,
      reason: describe(error),
      refused: false,
    };
  }
  const refusal = await gatewayRefusal(response);
  if (refusal) {
    return {
      ok: false,
      status: refusal.status,
      code: refusal.code,
      reason: `Context.dev is not available to this install: ${refusal.message}`,
      refused: true,
    };
  }
  const json: unknown = await response.json().catch(() => null);
  reportSpend(contextDevSpend(path, response.ok, json));
  if (response.ok) return { ok: true, body: json };
  const parsed = errorBody.parse(json);
  return {
    ok: false,
    status: response.status,
    code: parsed.error_code ?? null,
    reason: `${response.status} ${parsed.error_code ?? parsed.message ?? "error"}`,
    refused: false,
  };
}

/** Context.dev's brand for a domain. `maxAgeMs: 0` bypasses its cache. */
export async function brandByDomain(
  contextFetch: ContextFetch,
  domain: string,
  maxAgeMs?: number,
): Promise<LookupResult> {
  const answer = await post(contextFetch, "/brand/retrieve", {
    type: "by_domain",
    domain,
    ...(maxAgeMs === undefined ? {} : { maxAgeMs }),
  });
  if (!answer.ok) return classifyBrandFailure(answer);
  const brand = z
    .object({ brand: brandSchema.nullable().catch(null) })
    .catch({ brand: null })
    .parse(answer.body).brand;
  if (!brand) return { outcome: "skipped", reason: "No brand matched." };
  return { outcome: "found", brand, raw: answer.body };
}

function classifyBrandFailure(
  answer: Extract<Answer, { ok: false }>,
): LookupResult {
  if (answer.refused) {
    return { outcome: "failed", reason: answer.reason, retryable: false };
  }
  if (answer.status === 400) {
    if (answer.code === "NOT_FOUND") {
      return { outcome: "skipped", reason: "No brand matched this domain." };
    }
    if (answer.code === "WEBSITE_ACCESS_ERROR") {
      return { outcome: "skipped", reason: "The site could not be reached." };
    }
    return { outcome: "failed", reason: answer.reason, retryable: false };
  }
  if (answer.status === 422) {
    return {
      outcome: "skipped",
      reason: "That is a personal or disposable email address.",
    };
  }
  return {
    outcome: "failed",
    reason: answer.reason,
    retryable: retryable(answer.status),
  };
}

/** The person behind a profile URL (LinkedIn), as Context.dev reads it. */
export async function personByProfileUrl(
  contextFetch: ContextFetch,
  profileUrl: string,
): Promise<PersonMatch> {
  const answer = await post(contextFetch, "/people/enrich", {
    social_urls: [profileUrl],
  });
  return personFrom(answer, "No person matched that profile.");
}

type IdentityClues = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyDomain: string | null;
};

/**
 * The person behind a work email address, matched on every clue the CRM
 * holds: the address, any name on the record, and the employer.
 */
export async function personByClues(
  contextFetch: ContextFetch,
  clues: IdentityClues,
): Promise<PersonMatch> {
  const name = { first: given(clues.firstName), last: given(clues.lastName) };
  const company = {
    name: given(clues.companyName),
    domain: given(clues.companyDomain),
  };
  const answer = await post(contextFetch, "/people/enrich", {
    email: clues.email.trim(),
    ...(name.first || name.last ? { name } : {}),
    ...(company.name || company.domain ? { company } : {}),
  });
  return personFrom(answer, "No person matched those details.");
}

/** A clue worth sending: trimmed, and left out when blank. */
function given(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function personFrom(answer: Answer, notFound: string): PersonMatch {
  if (answer.ok) {
    return personFromMatch(
      z.object({ match: z.unknown() }).catch({ match: null }).parse(answer.body)
        .match,
    );
  }
  if (answer.refused) {
    return { outcome: "failed", reason: answer.reason, retryable: false };
  }
  if (answer.status === 400 || answer.status === 404) {
    return { outcome: "skipped", reason: notFound };
  }
  if (answer.status === 422) {
    return {
      outcome: "skipped",
      reason: "Context will not look that identifier up.",
    };
  }
  return {
    outcome: "failed",
    reason: answer.reason,
    retryable: retryable(answer.status),
  };
}

/** A JSON Schema object describing what to extract. */
export type JsonSchema = Record<string, unknown>;

/** The most pages one extraction reads, as the CRM's web.extract asked. */
const EXTRACT_MAX_PAGES = 8;

/**
 * Facts from a site, in the shape `schema` describes. Context.dev crawls from
 * `url` (its own domain, not its subdomains) and reads up to
 * EXTRACT_MAX_PAGES pages before it answers, so a brief can draw on the
 * pricing, customers and about pages, not only the one at `url`.
 */
export async function extractFromSite(
  contextFetch: ContextFetch,
  url: string,
  schema: JsonSchema,
  instructions: string,
): Promise<
  { outcome: "found"; data: unknown } | { outcome: "failed"; reason: string }
> {
  const answer = await post(contextFetch, "/web/extract", {
    url,
    schema,
    instructions,
    maxPages: EXTRACT_MAX_PAGES,
  });
  if (!answer.ok) return { outcome: "failed", reason: answer.reason };
  const { data } = z
    .object({ data: z.unknown() })
    .catch({ data: null })
    .parse(answer.body);
  if (data === null || data === undefined) {
    return {
      outcome: "failed",
      reason: "Nothing could be extracted from that site.",
    };
  }
  return { outcome: "found", data };
}

function retryable(status: number): boolean {
  if (status === 0 || status === 408 || status === 429) return true;
  if (status === 401 || status === 403) return false;
  return status >= 500;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
