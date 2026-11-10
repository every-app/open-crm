import { useQuery } from "@tanstack/react-query";
import { Navigate, getRouteApi } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { cn } from "cn";
import { z } from "zod";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  DealsInProgress,
  OverdueTasks,
  RecentActivity,
} from "@/client/features/dashboard/DashboardLists";
import { ListsCard } from "@/client/features/dashboard/ListsCard";
import { SalesSummary } from "@/client/features/dashboard/SalesSummary";
import { dashboardSummaryQueryOptions } from "@/client/features/dashboard/dashboardQueries";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { DASHBOARD_SCOPES } from "@/types/schemas/dashboard";

/** /: whose numbers Home shows, in the URL so a link brings it back. */
export const dashboardSearchSchema = z.object({
  scope: z.enum(DASHBOARD_SCOPES).optional().catch(undefined),
});

const routeApi = getRouteApi("/_app/overview");

const SCOPES = [
  { value: "everyone", label: "All deals" },
  { value: "me", label: "My deals" },
];

/**
 * Home: what to act on today (overdue tasks and the lists), then what
 * happened last. While deals are on, the viewer's (or the team's) sales sit
 * between the two. A card with nothing to show stays out.
 */
export function DashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const dealsEnabled =
    useQuery(workspaceQueryOptions()).data?.dealsEnabled ?? false;
  // Whose deals: everyone's while there are none to tell apart.
  const scope = dealsEnabled ? (search.scope ?? "everyone") : "everyone";
  const query = useQuery(dashboardSummaryQueryOptions(scope));
  const summary = query.data;
  const hasSales =
    dealsEnabled &&
    summary &&
    (summary.pipeline.count > 0 ||
      summary.performance.winRate !== null ||
      summary.wonThisMonth.count > 0 ||
      summary.wonLastMonth.count > 0 ||
      summary.trend.some((point) => point.won > 0 || point.created > 0));

  if (summary && !summary.multipleOwners && scope === "me") {
    return (
      <Navigate
        to="/overview"
        search={(prev) => ({ ...prev, scope: undefined })}
        replace
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
        <PageHeader
          title="Overview"
          actions={
            dealsEnabled && summary?.multipleOwners ? (
              <Select
                items={SCOPES}
                value={scope}
                onValueChange={(next) => {
                  if (next !== "me" && next !== "everyone") return;
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      scope: next === "everyone" ? undefined : next,
                    }),
                    replace: true,
                  });
                }}
              >
                <SelectTrigger aria-label="Deal owner" size="sm">
                  <Users />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
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
                fallback="The overview could not be refreshed."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : null}
            <div
              className={cn(
                "grid items-start gap-6",
                summary.overdueTasks.length > 0 && "lg:grid-cols-2",
              )}
            >
              <OverdueTasks summary={summary} />
              <ListsCard />
            </div>
            {hasSales ? <SalesSummary summary={summary} /> : null}
            {dealsEnabled ? <DealsInProgress summary={summary} /> : null}
            <RecentActivity summary={summary} dealsEnabled={dealsEnabled} />
          </div>
        ) : query.isError ? (
          <QueryError
            error={query.error}
            fallback="The overview could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            variant="page"
          />
        ) : (
          <div className="space-y-6" aria-busy>
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
            {dealsEnabled ? <SkeletonStatGrid /> : null}
            <Skeleton className="h-72" />
          </div>
        )}
      </div>
    </div>
  );
}
