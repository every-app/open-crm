import { createServerFn } from "@tanstack/react-start";
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

/** Overview's Get started steps for the signed-in person. */
export const getGetStarted = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SetupService.getStarted(
      context.organizationId,
      context.userId,
      hasOrgPermission(context.role, { workspace: ["manage"] }),
    ),
  );
