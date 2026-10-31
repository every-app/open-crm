import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  setDealsEnabledSchema,
  updateWorkspaceSchema,
} from "@/types/schemas/workspace";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ({
    ...(await WorkspaceService.getWorkspace(context.organizationId)),
    role: context.role,
  }));

export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateWorkspaceSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return WorkspaceService.updateWorkspace(context.organizationId, data);
  });

export const setDealsEnabled = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setDealsEnabledSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return WorkspaceService.setDealsEnabled(
      context.organizationId,
      data.enabled,
    );
  });
