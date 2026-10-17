import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { CrmAgent } from "./CrmAgent";

// A conversation's messages live in its CrmAgent Durable Object (Think's own
// storage), not in its agent_conversation row. Once the row is deleted no
// client can reach them (agentRoutes.ts refuses a session without one); this
// empties them as well, so deleting a conversation deletes what was said.

export async function forgetTranscript(sessionId: string): Promise<void> {
  const agent = await getAgentByName(crmAgentNamespace(), sessionId);
  await agent.clearMessages();
}

/** The CRM_AGENT binding with its class, as in scheduled.ts. */
function crmAgentNamespace(): DurableObjectNamespace<CrmAgent> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  return env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
}
