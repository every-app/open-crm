import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { SettingsService } from "@/server/features/settings/services/SettingsService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { agentModelId } from "@/server/lib/openrouter";
import {
  setArchiveRetentionSchema,
  setAutomaticResearchSchema,
} from "@/types/schemas/settings";

/**
 * The model the agent runs on. It isn't chosen in the app: Luna, or the
 * deployment's OPENROUTER_MODEL.
 */
export const getAgentModel = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => ({ id: await agentModelId() }));

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

/** Whether the research agent researches on its own (Research automatically). */
export const getAutomaticResearch = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SettingsService.getAutomaticResearch(context.organizationId),
  );

export const setAutomaticResearch = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setAutomaticResearchSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    return SettingsService.setAutomaticResearch(
      context.organizationId,
      data.enabled,
    );
  });
