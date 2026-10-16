// The research budget, ported from the CRM's lib/focus.ts. A unit is one
// metered vendor call's share, not one credit: every billable lookup (a brand,
// a person, a page extraction) costs 2, so a session with a budget of 4 can
// make two of them. Running out is a normal ending, not a failure.

export const BILLABLE_CALL_UNITS = 2;

export type BudgetState = { spent: number; budget: number; exhausted: boolean };

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
