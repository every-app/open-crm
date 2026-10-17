import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SetupService } from "@/server/features/setup/services/SetupService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { hasOrgPermission } from "@/shared/org-permissions";

/** What this gateway has set up for the CRM, and what each piece unlocks. */
export const getSetupChecklist = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SetupService.checklist(
      context.organizationId,
      hasOrgPermission(context.role, { workspace: ["manage"] }),
    ),
  );

export const dismissSetupChecklist = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await SetupService.dismiss(context.organizationId);
    return { dismissed: true };
  });
