import { queryOptions, useQuery } from "@tanstack/react-query";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { getCurrencySettings } from "@/serverFunctions/currency";
import {
  getAgentModel,
  getAgentStatus,
  getArchiveRetention,
} from "@/serverFunctions/settings";

/** Reporting currency, effective rates, the currencies deals are in. */
export const currencySettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "currencies"],
    queryFn: () => getCurrencySettings(),
  });

/** The model the research agent runs on; set by the deployment. */
export const agentModelQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "agent-model"],
    queryFn: () => getAgentModel(),
    staleTime: Infinity,
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
