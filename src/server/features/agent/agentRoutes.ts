/**
 * The agent's chats live behind /agents/*. Phase 3 routes them to CrmAgent
 * after checking the conversation belongs to the caller's organization.
 */
export function routeAgentRequests(
  _request: Request,
  _env: Env,
): Response | Promise<Response> {
  return new Response("Not found", { status: 404 });
}
