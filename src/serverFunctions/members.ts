import { createServerFn } from "@tanstack/react-start";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

/**
 * The organization's members who have opened the CRM: owner pickers,
 * "assigned to" filters and Settings → Members. The gateway owns the real
 * list (invitations, roles, removals); this is its mirror.
 */
export const listMembers = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    AuthRepository.listMembers(context.organizationId),
  );
