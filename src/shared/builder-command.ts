// Whether a builder chat message asks for an agent, ported from the CRM's
// lib/agent-builder.ts: "/Create agent …" (the composer's Create agent
// switch), or a plain request to create, build or set up an agent. A question
// about agents ("how do I create an agent?") and a refusal ("don't make an
// agent") stay questions. The composer switches Create agent on when it reads
// one, and the builder's turn (team-agents/runtime/turns.ts) is classified by
// the same rules.

type BuilderCommandType = "CHAT" | "CREATE_AGENT";

const CREATE_AGENT = /^\/create(?:\s+agent|-agent)(?:\s|$)/i;
const CREATE_AGENT_REQUEST =
  /\b(?:create|build|draft|make|configure|set\s+up)(?:\s+me)?\s+(?:(?:and\s+save)\s+)?(?:(?:a|an|the|this)\s+)?(?:new\s+)?agent\b/i;
const CREATE_AGENT_NON_REQUEST =
  /\b(?:(?:do\s+not|don't|dont|never)\b[^.!?]*|how\s+(?:(?:do|can|could|would|should)\s+(?:i|we)|to))\s*$/i;
const CREATE_AGENT_QUESTION =
  /^(?:how|why|when|where|what|does|do|did|is|are|will|would|can|could|should)\b/i;
const CREATE_AGENT_REQUEST_CUE =
  /\b(?:please|plz|(?:can|could|would|will)\s+you|i\s+(?:need|want)\b|we\s+need\b|let'?s)\b/i;

function isCreateAgentRequest(message: string): boolean {
  const match = CREATE_AGENT_REQUEST.exec(message);
  if (!match) return false;
  const prefix = message.slice(0, match.index);
  if (CREATE_AGENT_NON_REQUEST.test(prefix)) return false;
  return !(
    message.trimEnd().endsWith("?") &&
    CREATE_AGENT_QUESTION.test(message.trimStart()) &&
    !CREATE_AGENT_REQUEST_CUE.test(prefix)
  );
}

export function builderCommandType(message: string): BuilderCommandType {
  const trimmed = message.trimStart();
  return CREATE_AGENT.test(trimmed) || isCreateAgentRequest(trimmed)
    ? "CREATE_AGENT"
    : "CHAT";
}

/** The rest of a message that opens with "/Create agent", or null. */
export function consumeBuilderCommand(message: string): string | null {
  const trimmed = message.trimStart();
  const match = CREATE_AGENT.exec(trimmed);
  return match ? trimmed.slice(match[0].length).trimStart() : null;
}
