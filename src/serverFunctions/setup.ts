import { createServerFn } from "@tanstack/react-start";
import { SetupService } from "@/server/features/setup/services/SetupService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

/** What this gateway has set up for the CRM, and what each piece unlocks. */
export const getSetupChecklist = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SetupService.checklist(context.organizationId),
  );
