import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { SettingsService } from "@/server/features/settings/services/SettingsService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  setAgentModelSchema,
  setArchiveRetentionSchema,
} from "@/types/schemas/settings";

export const getAgentModel = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SettingsService.getAgentModel(context.organizationId),
  );

export const getModelCatalog = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => SettingsService.getModelCatalog());

export const setAgentModel = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setAgentModelSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return SettingsService.setAgentModel(context.organizationId, data.modelId);
  });

/**
 * Whether the agent can run: its model and Context.dev, as the gateway
 * answers for them. Nothing here is a key: the gateway holds them all.
 */
export const getAgentStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    AgentAvailabilityService.forOrganization(context.organizationId),
  );

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
