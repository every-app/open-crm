export const IMAGE_ROUTE_PREFIX = "/api/images/";

/**
 * Serves a logo or photograph the agent copied into R2. Phase 3 stores them
 * under the organization's prefix and checks it here.
 */
export function serveImage(_request: Request, _env: Env): Response {
  return new Response("Not found", { status: 404 });
}
