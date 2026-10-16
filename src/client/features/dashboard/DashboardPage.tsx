import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { cn } from "cn";
import { z } from "zod";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { EnrichmentQueue } from "@/client/features/agent/EnrichmentQueue";
import {
  DealsInProgress,
  OverdueTasks,
  RecentActivity,
} from "@/client/features/dashboard/DashboardLists";
import { SalesSummary } from "@/client/features/dashboard/SalesSummary";
import { dashboardSummaryQueryOptions } from "@/client/features/dashboard/dashboardQueries";
import {
  DASHBOARD_SCOPES,
  type DashboardScope,
} from "@/types/schemas/dashboard";

/** /: whose numbers Home shows, in the URL so a link brings it back. */
export const dashboardSearchSchema = z.object({
  scope: z.enum(DASHBOARD_SCOPES).optional().catch(undefined),
});

const routeApi = getRouteApi("/_app/");

const SCOPE_LABELS: Record<DashboardScope, string> = {
  me: "Me",
  everyone: "Everyone",
};

const DESCRIPTIONS: Record<DashboardScope, string> = {
  me: "What you have closed, what is still in play, and what needs you today.",
  everyone:
    "What the team has closed, what is still in play, and what needs you today.",
};

/** Home: the viewer's (or the team's) sales at a glance. */
export function DashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const scope = search.scope ?? "me";
  const query = useQuery(dashboardSummaryQueryOptions(scope));
  const summary = query.data;

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="Welcome back"
          description={DESCRIPTIONS[scope]}
          actions={
            <>
              <EnrichmentQueue />
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                value={[scope]}
                onValueChange={(next) => {
                  const picked = DASHBOARD_SCOPES.find(
                    (value) => value === next[0],
                  );
                  if (!picked) return;
                  void navigate({
                    search: { scope: picked === "me" ? undefined : picked },
                    replace: true,
                  });
                }}
                aria-label="Whose numbers to show"
              >
                {DASHBOARD_SCOPES.map((value) => (
                  <ToggleGroupItem key={value} value={value}>
                    {SCOPE_LABELS[value]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </>
          }
        />

        {summary ? (
          <div
            className={cn(
              "space-y-6 transition-opacity",
              // The other scope's figures are on their way.
              query.isPlaceholderData && "opacity-60",
            )}
          >
            {query.isError ? (
              <QueryError
                error={query.error}
                fallback="Home could not be refreshed."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : null}
            <SalesSummary summary={summary} />
            <div className="grid gap-6 lg:grid-cols-2">
              <DealsInProgress summary={summary} />
              <OverdueTasks summary={summary} />
            </div>
            <RecentActivity summary={summary} />
          </div>
        ) : query.isError ? (
          <QueryError
            error={query.error}
            fallback="Home could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            variant="page"
          />
        ) : (
          <div className="space-y-6" aria-busy>
            <SkeletonStatGrid />
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
