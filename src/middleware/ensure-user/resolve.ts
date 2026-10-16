import { resolveEveryAppContext } from "./everyApp";
import type { EnsuredUserContext } from "./types";

// Resolves the authenticated user for a request's headers. Shared by
// ensureUserMiddleware (server functions) and raw routes (the agent's
// WebSocket), which can't use function middleware.
export function resolveUserContextFromHeaders(
  headers: Headers,
): Promise<EnsuredUserContext> {
  return resolveEveryAppContext(headers);
}
