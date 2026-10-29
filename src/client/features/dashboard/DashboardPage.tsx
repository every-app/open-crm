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
import { SalesSummary } from "@/client/features/dashboard/SalesSummary";
import { FirstFollowUp } from "@/client/features/dashboard/FirstFollowUp";
import { GetStartedCard } from "@/client/features/setup/GetStartedCard";
import { dashboardSummaryQueryOptions } from "@/client/features/dashboard/dashboardQueries";
import { DASHBOARD_SCOPES } from "@/types/schemas/dashboard";

/** /: whose numbers Home shows, in the URL so a link brings it back. */
export const dashboardSearchSchema = z.object({
  scope: z.enum(DASHBOARD_SCOPES).optional().catch(undefined),
});

const routeApi = getRouteApi("/_app/");

const SCOPES = [
  { value: "everyone", label: "All deals" },
  { value: "me", label: "My deals" },
];

/** Home: the viewer's (or the team's) sales at a glance. */
export function DashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const scope = search.scope ?? "everyone";
  const query = useQuery(dashboardSummaryQueryOptions(scope));
  const summary = query.data;
  const hasSales =
    summary &&
    (summary.pipeline.count > 0 ||
      summary.performance.winRate !== null ||
      summary.wonThisMonth.count > 0 ||
      summary.wonLastMonth.count > 0 ||
      summary.trend.some((point) => point.won > 0 || point.created > 0));
  const hasActivity =
    summary &&
    (summary.overdueTasks.length > 0 || summary.recentActivity.length > 0);

  if (summary && !summary.multipleOwners && scope === "me") {
    return (
      <Navigate
        to="/"
        search={(prev) => ({ ...prev, scope: undefined })}
        replace
      />
    );
  }
  const firstDeal =
    summary?.pipeline.count === 1 ? summary.biggestOpen[0] : undefined;

  return (
    <div className="flex min-h-full flex-col px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
        <PageHeader
          title="Overview"
          description="Pipeline, overdue tasks and recent activity."
          actions={
            summary?.multipleOwners ? (
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

        {summary && !hasSales ? (
          <GetStartedCard
            company={summary.firstCompany}
            hasDeals={summary.hasDeals}
            prominent={!hasActivity}
          />
        ) : null}

        {firstDeal && !firstDeal.followUpAt ? (
          <FirstFollowUp deal={firstDeal} />
        ) : null}

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
            {hasSales ? <SalesSummary summary={summary} /> : null}
            <div
              className={cn(
                "grid gap-6",
                summary.biggestOpen.length > 0 &&
                  summary.overdueTasks.length > 0 &&
                  "lg:grid-cols-2",
              )}
            >
              <DealsInProgress summary={summary} />
              <OverdueTasks summary={summary} />
            </div>
            <RecentActivity summary={summary} />
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
