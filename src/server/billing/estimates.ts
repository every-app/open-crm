import { creditsForProviderUsd } from "@/shared/billing";

// What paid work may cost, in credits, before it starts. Background work is
// admitted per task against the balance (credits.ts), and the least a balance
// must hold for the agent to start anything is what a chat turn may cost.
// Work is still billed at what it really cost (meter.ts), so an estimate only
// paces how much starts on one balance reading.

/**
 * A session's model calls: about the most an OpenSEO SAM turn on GPT Luna
 * cost in the 30 days to 2026-10-19 (p50 $0.006, p99 $0.024, max $0.044).
 */
const SESSION_MODEL_USD = 0.05;

/**
 * One research unit, spent at Context.dev's list price (contextDevPricing.ts):
 * a lookup is two units, and the dearest, a person, is $0.05.
 */
const RESEARCH_UNIT_USD = 0.025;

/** The lookups the dispatcher makes without a model, at list price. */
const LOOKUP_USD: Partial<Record<string, number>> = {
  brand: 0.025,
  // A person, and a page of their employer's site.
  portrait: 0.075,
};

/** A session's estimate: its model calls, and its research budget spent. */
export function sessionEstimate(researchUnits: number): number {
  return creditsForProviderUsd(
    SESSION_MODEL_USD + researchUnits * RESEARCH_UNIT_USD,
  );
}

/** A queued task's estimate: its lookup's list price, or its session's. */
export function taskEstimate(task: { kind: string; budget: number }): number {
  const lookup = LOOKUP_USD[task.kind];
  return lookup === undefined
    ? sessionEstimate(task.budget)
    : creditsForProviderUsd(lookup);
}

/**
 * What a person's chat turn may cost (its research budget is CrmAgent's
 * CHAT_BUDGET, 4 units). Below it, an organization is out of credits for the
 * agent: chats are refused and paid background work waits.
 */
export const AGENT_MINIMUM_CREDITS = sessionEstimate(4);
