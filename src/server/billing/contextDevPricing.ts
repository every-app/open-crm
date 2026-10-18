import { z } from "zod";
import type { ProviderSpend } from "./spendSink";

// What a Context.dev call costs, billed at the provider's price times the
// markup (creditsForProviderUsd), as OpenSEO bills its Context.dev renders.
// Context.dev reports each call's charge in its body
// (key_metadata.credits_consumed, on errors too: a 404 is billed at the
// call's base price), and that is what's billed. The list prices below are
// the fallback for an answer that leaves it out, charged only for a success.
//
// Source: https://www.context.dev/pricing, "API credit costs", read
// 2026-10-17. The per-path mapping is ours: /people/enrich is "Enrich
// Person" (20 per match). /web/extract, which reads up to eight pages of a
// site, is listed at 10 a request in its API reference
// (https://docs.context.dev/api-reference/web-extraction/extract).
const CONTEXT_DEV_CREDITS: Record<string, number> = {
  "/brand/retrieve": 10,
  "/people/enrich": 20,
  "/web/extract": 10,
};

// OpenSEO's price for one Context.dev credit (CONTEXT_USD_PER_CREDIT): the
// Developer plan's list price.
const CONTEXT_USD_PER_CREDIT = 0.0025;

const reportedUsage = z.object({
  key_metadata: z.object({ credits_consumed: z.number().nonnegative() }),
});

/** The charge for one Context.dev answer to `path`. */
export function contextDevSpend(
  path: string,
  ok: boolean,
  body: unknown,
): ProviderSpend {
  const reported = reportedUsage.safeParse(body);
  const credits = reported.success
    ? reported.data.key_metadata.credits_consumed
    : ok
      ? (CONTEXT_DEV_CREDITS[path] ?? 0)
      : 0;
  return {
    provider: "context",
    creditFeature: "company_data",
    operation: path.slice(1),
    costUsd: credits * CONTEXT_USD_PER_CREDIT,
  };
}
