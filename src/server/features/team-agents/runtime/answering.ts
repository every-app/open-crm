import { env } from "cloudflare:workers";
import { settledWithin } from "@/server/features/agent/dispatch/pool";
import type { CrmAgent } from "@/server/features/agent/CrmAgent";

// Which builder chats are answering now, for the spinner in Chat's column
// (the CRM's "working" chats): each one is asked of its own CrmAgent, whose
// stream state says whether a turn is running, rather than guessed from the
// conversation's timestamps. The Agents SDK loads on the first ask, not with
// the builder's other server functions.

const ASK_TIMEOUT_MS = 2_000;

/** The sessions among `sessionIds` whose agent is answering a turn. */
export async function answeringSessions(
  sessionIds: readonly string[],
): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const { getAgentByName } = await import("agents");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  const agents = env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
  const answers = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const asked = getAgentByName(agents, sessionId)
        .then((agent) => agent.isAnswering())
        .catch((error: unknown) => {
          console.warn(
            "[team-agents] could not ask a chat if it is answering",
            {
              sessionId,
              reason: error instanceof Error ? error.message : String(error),
            },
          );
          return false;
        });
      const outcome = await settledWithin(asked, ASK_TIMEOUT_MS);
      return outcome.settled && outcome.value ? [sessionId] : [];
    }),
  );
  return new Set(answers.flat());
}
