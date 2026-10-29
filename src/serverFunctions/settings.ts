import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SettingsService } from "@/server/features/settings/services/SettingsService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { setArchiveRetentionSchema } from "@/types/schemas/settings";

export const getArchiveRetention = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SettingsService.getArchiveRetention(context.organizationId),
  );

export const setArchiveRetention = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setArchiveRetentionSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return SettingsService.setArchiveRetention(
      context.organizationId,
      data.days,
    );
  });
