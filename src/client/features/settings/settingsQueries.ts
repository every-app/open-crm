import { queryOptions, useQuery } from "@tanstack/react-query";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { getCurrencySettings } from "@/serverFunctions/currency";
import {
  getAgentModel,
  getAgentStatus,
  getArchiveRetention,
  getModelCatalog,
} from "@/serverFunctions/settings";

/** Reporting currency, effective rates, the currencies deals are in. */
export const currencySettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "currencies"],
    queryFn: () => getCurrencySettings(),
  });

/** The model the research agent runs on. */
export const agentModelQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "agent-model"],
    queryFn: () => getAgentModel(),
  });

/** OpenRouter's tool-using models; the server caches the list too. */
export const modelCatalogQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "model-catalog"],
    queryFn: () => getModelCatalog(),
    staleTime: 30 * 60 * 1000,
  });

/** What the agent has to work with: its model and Context.dev. */
export const agentStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "agent-status"],
    queryFn: () => getAgentStatus(),
    // It changes on the gateway, not here.
    staleTime: 60_000,
  });

export const archiveRetentionQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "archive-retention"],
    queryFn: () => getArchiveRetention(),
  });

/** Whether the viewer's gateway role may change workspace settings. */
export function useCanManageWorkspace(): boolean {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  return workspace
    ? hasOrgPermission(workspace.role, { workspace: ["manage"] })
    : false;
}
