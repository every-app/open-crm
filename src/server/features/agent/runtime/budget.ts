import type { LanguageModelUsage } from "ai";
import { z } from "zod";

// The research budget, ported from the CRM's lib/focus.ts. A unit is one
// metered vendor call's share, not one credit: every billable lookup (a brand,
// a person, a page extraction) costs 2, so a session with a budget of 4 can
// make two of them. Beside it, a research session's tokens are capped, as the
// CRM capped its agent's sessions. Running out of either is a normal ending,
// not a failure. Both are kept in the session's own storage, so they outlive
// the Durable Object's memory and carry over to a retried attempt.

export const BILLABLE_CALL_UNITS = 2;

type BudgetState = { spent: number; budget: number; exhausted: boolean };

export type Spend = (
  units?: number,
) => { ok: true } | { ok: false; reason: string };

/**
 * A spend function over `state`, calling `persist` with each change so the
 * budget outlives the Durable Object's memory.
 */
export function budgetSpender(
  state: BudgetState,
  persist: (state: BudgetState) => void,
): Spend {
  return (units = 1) => {
    if (state.spent + units > state.budget) {
      if (!state.exhausted) {
        state.exhausted = true;
        persist(state);
      }
      return {
        ok: false,
        reason:
          `The research budget for this session is spent (${state.spent}/${state.budget}). ` +
          "Write up what you already have, or schedule a recheck with a reason. Do not keep looking.",
      };
    }
    state.spent += units;
    persist(state);
    return { ok: true };
  };
}

/** A spend that never refuses, for work outside a research session. */
export const FREE: Spend = () => ({ ok: true });

/** A CrmAgent's own synchronous storage (ctx.storage.kv). */
type SessionStorage = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
};

const BUDGET_KEY = "crm-agent:budget";
const TOKENS_KEY = "crm-agent:tokens";

const budgetState = z.object({
  spent: z.number(),
  budget: z.number(),
  exhausted: z.boolean(),
});

/** The session's research budget: `budget` until it has spent any. */
export function sessionSpender(storage: SessionStorage, budget: number): Spend {
  const stored = budgetState.safeParse(storage.get(BUDGET_KEY));
  return budgetSpender(
    stored.success ? stored.data : { spent: 0, budget, exhausted: false },
    (state) => storage.put(BUDGET_KEY, { ...state }),
  );
}

/** A fresh research budget, for a person's new turn. */
export function renewBudget(storage: SessionStorage, budget: number): void {
  storage.put(BUDGET_KEY, { spent: 0, budget, exhausted: false });
}

/**
 * What a research session may read and write, across its turns and attempts:
 * the CRM's limits on its agent's sessions (agent.ts).
 */
const SESSION_TOKENS = { input: 500_000, output: 50_000 };

const tokenUse = z
  .object({ input: z.number(), output: z.number() })
  .catch({ input: 0, output: 0 });

const TOKENS_SPENT =
  "The token budget for this session is spent. Call no more tools: write up what you already have, as you would when the research budget runs out.";

/** Adds a step's tokens to the research session's. */
export function addTokens(
  storage: SessionStorage,
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
): void {
  const used = tokenUse.parse(storage.get(TOKENS_KEY));
  storage.put(TOKENS_KEY, {
    input: used.input + (usage.inputTokens ?? 0),
    output: used.output + (usage.outputTokens ?? 0),
  });
}

/**
 * The step a research session takes once its tokens are spent: no tools, and
 * the instruction to write up what it has, so it ends as running out of
 * research budget ends it, not with an error. Undefined while tokens remain.
 */
export function writeUpStep(
  storage: SessionStorage,
  system: string,
): { activeTools: string[]; system: string } | undefined {
  const used = tokenUse.parse(storage.get(TOKENS_KEY));
  if (
    used.input < SESSION_TOKENS.input &&
    used.output < SESSION_TOKENS.output
  ) {
    return undefined;
  }
  return { activeTools: [], system: `${system}\n\n${TOKENS_SPENT}` };
}
