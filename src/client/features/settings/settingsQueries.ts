import { queryOptions, useQuery } from "@tanstack/react-query";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { getCurrencySettings } from "@/serverFunctions/currency";
import { getArchiveRetention } from "@/serverFunctions/settings";

/** Reporting currency, effective rates, the currencies deals are in. */
export const currencySettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "currencies"],
    queryFn: () => getCurrencySettings(),
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
