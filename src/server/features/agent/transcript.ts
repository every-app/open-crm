import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { UIMessage } from "ai";
import type { CrmAgent } from "./CrmAgent";

/**
 * A conversation's messages, for a reader who can't open its socket (a
 * shared builder chat's, features/sharing).
 */
export async function readTranscript(sessionId: string): Promise<UIMessage[]> {
  const agent = await getAgentByName(crmAgentNamespace(), sessionId);
  return agent.getMessages();
}

/** The CRM_AGENT binding with its class, as in scheduled.ts. */
function crmAgentNamespace(): DurableObjectNamespace<CrmAgent> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  return env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
}
