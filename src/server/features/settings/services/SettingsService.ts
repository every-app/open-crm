import { ModelCatalogService } from "@/server/features/settings/services/ModelCatalogService";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { AppError } from "@/server/lib/errors";
import { DEFAULT_AGENT_MODEL } from "@/server/lib/openrouter";

// The workspace's own settings beyond its name and website: the model the
// research agent runs on and how long archived records are kept. Owners and
// admins change them; everyone sees them.

export type AgentModelSetting = {
  /** The model the agent runs on. */
  id: string;
  contextWindowTokens: number;
  /** Whether the workspace follows the default model rather than a pick. */
  isDefault: boolean;
  defaultId: string;
};

/** The model the organization's research agent runs on. */
async function getAgentModel(
  organizationId: string,
): Promise<AgentModelSetting> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  if (!row.agentModelId) {
    return {
      ...DEFAULT_AGENT_MODEL,
      isDefault: true,
      defaultId: DEFAULT_AGENT_MODEL.id,
    };
  }
  return {
    id: row.agentModelId,
    contextWindowTokens:
      row.agentModelContextWindow ?? DEFAULT_AGENT_MODEL.contextWindowTokens,
    isDefault: false,
    defaultId: DEFAULT_AGENT_MODEL.id,
  };
}

/**
 * Puts the agent on `modelId` from its next session, once OpenRouter's
 * catalog confirms it is a tool-using model; null goes back to the default.
 */
async function setAgentModel(
  organizationId: string,
  modelId: string | null,
): Promise<AgentModelSetting> {
  if (modelId === null) {
    await WorkspaceRepository.update(organizationId, {
      agentModelId: null,
      agentModelContextWindow: null,
    });
    console.log("[settings] agent model reset to the default", {
      organizationId,
    });
    return getAgentModel(organizationId);
  }

  const models = await ModelCatalogService.models();
  if (!models) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Could not reach OpenRouter to check that model.",
    );
  }
  const chosen = models.find((model) => model.id === modelId);
  if (!chosen) {
    throw new AppError(
      "VALIDATION_ERROR",
      `OpenRouter serves no tool-using model called "${modelId}".`,
    );
  }
  await WorkspaceRepository.update(organizationId, {
    agentModelId: chosen.id,
    agentModelContextWindow: chosen.contextWindowTokens,
  });
  console.log("[settings] agent model changed", {
    organizationId,
    modelId: chosen.id,
  });
  return getAgentModel(organizationId);
}

/** OpenRouter's tool-using models, and whether the list could be loaded. */
async function getModelCatalog() {
  const models = await ModelCatalogService.models();
  return { models: models ?? [], available: models !== null };
}

async function getArchiveRetention(
  organizationId: string,
): Promise<{ days: number }> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return { days: row.archiveRetentionDays };
}

/** How many days an archived record is kept before it is purged for good. */
async function setArchiveRetention(
  organizationId: string,
  days: number,
): Promise<{ days: number }> {
  await WorkspaceRepository.update(organizationId, {
    archiveRetentionDays: days,
  });
  console.log("[settings] archive retention changed", {
    organizationId,
    days,
  });
  return getArchiveRetention(organizationId);
}

export const SettingsService = {
  getAgentModel,
  setAgentModel,
  getModelCatalog,
  getArchiveRetention,
  setArchiveRetention,
};
