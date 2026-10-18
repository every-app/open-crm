import type { UIMessage } from "ai";
import { env } from "cloudflare:workers";
import type { CrmAgent } from "@/server/features/agent/CrmAgent";

// A chat started from Chat home opens with its first message, handed to the
// chat's CrmAgent by the call that starts the chat (BuilderService), as the
// CRM's API stored a new chat's first submission with it. The agent accepts
// it durably and answers it as it answers a message sent over the socket; a
// retry hands the same message again, which it takes once. The Agents SDK
// loads with the first chat started, not with the builder's other server
// functions.

export async function handFirstMessage(
  sessionId: string,
  message: UIMessage,
): Promise<void> {
  const { getAgentByName } = await import("agents");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CRM_AGENT is always the CrmAgent class (everyapp.config.ts); only its generated type lacks the class
  const agents = env.CRM_AGENT as unknown as DurableObjectNamespace<CrmAgent>;
  const agent = await getAgentByName(agents, sessionId);
  // The stub types the answer as `never` (Think's metadata is `unknown`,
  // which RPC can't promise to carry), though it is plain data.
  await Promise.resolve(
    agent.submitMessages([message], { idempotencyKey: message.id }),
  );
}
