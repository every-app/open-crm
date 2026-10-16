import { queryOptions } from "@tanstack/react-query";
import { getWorkspace } from "@/serverFunctions/workspace";

// The organization's workspace: its name, website, whether onboarding is
// done, and the viewer's gateway role.
export const workspaceQueryOptions = () =>
  queryOptions({
    queryKey: ["workspace"],
    queryFn: () => getWorkspace(),
  });
