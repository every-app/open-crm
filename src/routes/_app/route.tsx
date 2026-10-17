import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SkeletonPage } from "@/client/components/SkeletonPresets";
import { QueryError } from "@/client/components/QueryState";
import { AppLayout } from "@/client/layout/AppShell";
import { QuickSwitcher } from "@/client/features/search/QuickSwitcher";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";

export const Route = createFileRoute("/_app")({
  component: AppRouteLayout,
});

// One layout for every signed-in page. The gateway has already signed the
// person in; the shell paints at once and the page waits for the workspace,
// which also decides whether onboarding comes first.
function AppRouteLayout() {
  const workspaceQuery = useQuery(workspaceQueryOptions());
  const workspace = workspaceQuery.data;

  if (workspace && !workspace.onboarded) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <AppLayout
      workspaceName={workspace?.name ?? null}
      sidebarHeader={<QuickSwitcher />}
    >
      {workspace ? (
        <Outlet />
      ) : workspaceQuery.isError ? (
        <div className="p-6">
          <QueryError
            error={workspaceQuery.error}
            fallback="The workspace could not be loaded."
            onRetry={() => void workspaceQuery.refetch()}
            isRetrying={workspaceQuery.isFetching}
            variant="page"
          />
        </div>
      ) : (
        <SkeletonPage />
      )}
    </AppLayout>
  );
}
