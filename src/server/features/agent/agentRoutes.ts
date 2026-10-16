import { routeAgentRequest } from "agents";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { AgentConversationRepository } from "./repositories/AgentConversationRepository";
import { parseSessionName } from "./sessionName";

// The agent's chats live behind /agents/crm-agent/<session id>: the WebSocket
// the Agent tab talks over, and the HTTP reads Think serves beside it (the
// conversation's messages). Both are authorized here, in the Worker, before
// anything reaches the Durable Object, as OpenSEO authorizes SAM: the session
// must be a conversation of the caller's organization (its name says which,
// sessionName.ts) and the caller's own. Research sessions are never reachable
// from a client.

const CRM_AGENT = "CRM_AGENT";

async function authorizeConversation(
  request: Request,
  route: { className: string; name: string },
): Promise<Response | undefined> {
  if (route.className !== CRM_AGENT) return forbidden();
  const session = parseSessionName(route.name);
  if (session?.kind !== "chat") return forbidden();
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (session.organizationId !== context.organizationId) return forbidden();
  const conversation = await AgentConversationRepository.findBySession(
    context.organizationId,
    route.name,
  );
  if (!conversation || conversation.userId !== context.userId)
    return forbidden();
  return undefined;
}

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

export async function routeAgentRequests(
  request: Request,
  env: Env,
): Promise<Response> {
  const response = await routeAgentRequest(request, env, {
    onBeforeConnect: (incoming, route) =>
      authorizeConversation(incoming, route),
    onBeforeRequest: (incoming, route) =>
      authorizeConversation(incoming, route),
  });
  return response ?? new Response("Not found", { status: 404 });
}
