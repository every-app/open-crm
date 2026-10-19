import type { LanguageModelUsage } from "ai";
import { z } from "zod";
import type { AgentSession, ChatSession } from "./session";

// A session's two budgets, both kept in its own storage, so they outlive the
// Durable Object's memory and carry over to a retried attempt.
//
// The research budget, ported from the CRM's lib/focus.ts, is how many paid
// lookups a session may make before it writes up. Units aren't money (each
// vendor call is billed at its real cost): they price calls as the CRM did.
// A lookup (a brand, a person, a page extraction, a search for someone's
// profiles) costs 2, a quick web question 1 and a deep one 2, and checking an
// X handle nothing, so a budget of 4 buys two lookups or four quick questions.
//
// Tokens are capped as the CRM capped its agents' sessions (TOKEN_LIMITS),
// counted as its runtime counted them: the provider's usage, added up across
// the session's turns and checked before each model call, so the call that
// crosses a limit finishes. Past them, a research session or a chat writes up
// what it has with no more tools, and a team agent's run fails, as the CRM's
// runs did. Running out of research budget is a normal ending too.

/** What a lookup costs: a brand, a person, a page extraction, a profile search. */
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
/** The tokens since the person's latest message: a build's own. */
const TURN_TOKENS_KEY = "crm-agent:turn-tokens";

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

type TokenLimit = { input: number; output: number };

/**
 * The CRM's token limits: its agent's on every session, research and chats
 * alike (agent.ts); its build subagent's on each build, within the chat's
 * (agent_builder/agent.ts); and its runner's on each run
 * (agent_runner/agent.ts).
 */
const TOKEN_LIMITS = {
  session: { input: 500_000, output: 50_000 },
  build: { input: 100_000, output: 10_000 },
  run: { input: 500_000, output: 40_000 },
} satisfies Record<string, TokenLimit>;

const tokenUse = z
  .object({ input: z.number(), output: z.number() })
  .catch({ input: 0, output: 0 });

const WRITE_UP = {
  session:
    "The token budget for this session is spent. Call no more tools: write up what you already have, as you would when the research budget runs out.",
  build:
    "The token budget for this build is spent. Call no more tools: say where the build got to, and if no draft was saved, explain that the build could not finish and ask the person to try again.",
};

/** Adds a step's tokens to the session's, and to its turn's. */
export function addTokens(
  storage: SessionStorage,
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
): void {
  for (const key of [TOKENS_KEY, TURN_TOKENS_KEY]) {
    const used = tokenUse.parse(storage.get(key));
    storage.put(key, {
      input: used.input + (usage.inputTokens ?? 0),
      output: used.output + (usage.outputTokens ?? 0),
    });
  }
}

/** A person's new turn counts its own tokens from here, for a build's limit. */
export function startTurnTokens(storage: SessionStorage): void {
  storage.put(TURN_TOKENS_KEY, { input: 0, output: 0 });
}

/** The limit the tokens kept at `key` have reached, input first, or null. */
function reached(
  storage: SessionStorage,
  key: string,
  limit: TokenLimit,
): "input" | "output" | null {
  const used = tokenUse.parse(storage.get(key));
  if (used.input >= limit.input) return "input";
  if (used.output >= limit.output) return "output";
  return null;
}

/** Whether a research session's or a chat's tokens are spent. */
function tokensSpent(storage: SessionStorage): boolean {
  return reached(storage, TOKENS_KEY, TOKEN_LIMITS.session) !== null;
}

/**
 * What a chat answers a person's new message with once its tokens are spent,
 * in place of a turn; null while they remain.
 */
export function spentChatReply(
  storage: SessionStorage,
  kind: ChatSession["conversation"]["kind"],
): string | null {
  if (!tokensSpent(storage)) return null;
  return kind === "BUILDER"
    ? "This chat has hit its token limit. Start a new chat."
    : "This conversation has hit its token limit. Start a new conversation.";
}

/**
 * A session's next model call, within its token limits. A research session
 * or a chat whose tokens are spent, or a build whose own are, takes a step
 * with no tools and the instruction to write up what it has, so it ends as
 * running out of research budget ends it, not with an error. A run that has
 * spent its tokens fails the call instead, in the words the CRM's runtime
 * failed an unattended session with (SESSION_TOKEN_LIMIT_REACHED), so the run
 * ends FAILED, as TURN_FAILED. Undefined while tokens remain.
 */
export function tokenLimitStep(
  storage: SessionStorage,
  turn: { kind: AgentSession["kind"]; system: string; building: boolean },
): { activeTools: string[]; system: string } | undefined {
  if (turn.kind === "run") {
    const limit = reached(storage, TOKENS_KEY, TOKEN_LIMITS.run);
    if (limit) {
      throw new Error(
        `The session reached its configured ${limit} token limit.`,
      );
    }
    return undefined;
  }
  const spent = tokensSpent(storage)
    ? "session"
    : turn.building && reached(storage, TURN_TOKENS_KEY, TOKEN_LIMITS.build)
      ? "build"
      : null;
  if (!spent) return undefined;
  return { activeTools: [], system: `${turn.system}\n\n${WRITE_UP[spent]}` };
}
