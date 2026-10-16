import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";

// Every server function runs as the signed-in member, in the organization
// their identity names. Repositories take that organizationId and filter by
// it on every read and write.
export const ensureUserMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const context = await resolveUserContextFromHeaders(getRequest().headers);
  return next({ context });
});
