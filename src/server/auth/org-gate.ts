import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import {
  hasOrgPermission,
  type OrgPermissionRequest,
} from "@/shared/org-permissions";

/** Throws FORBIDDEN unless the caller's gateway role grants `permissions`. */
export function requireOrgPermission(
  context: Pick<EnsuredUserContext, "role">,
  permissions: OrgPermissionRequest,
): void {
  if (!hasOrgPermission(context.role, permissions)) {
    throw new AppError("FORBIDDEN");
  }
}
