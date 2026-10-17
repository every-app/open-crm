import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isBillingEnabled } from "@/server/billing/hosted";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { updateWorkspaceSchema } from "@/types/schemas/workspace";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ({
    ...(await WorkspaceService.getWorkspace(context.organizationId)),
    role: context.role,
    // Usage is billed here (hosted): Settings → Billing and the credits banner.
    billing: await isBillingEnabled(),
  }));

export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateWorkspaceSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return WorkspaceService.updateWorkspace(context.organizationId, data);
  });
