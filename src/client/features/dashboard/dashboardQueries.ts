import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getDashboardSummary } from "@/serverFunctions/dashboard";
import type { DashboardScope } from "@/types/schemas/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: (scope: DashboardScope) => ["dashboard", "summary", scope] as const,
};

/** Home's figures and lists, for the viewer's deals or everyone's. */
export const dashboardSummaryQueryOptions = (scope: DashboardScope) =>
  queryOptions({
    queryKey: dashboardKeys.summary(scope),
    queryFn: () => getDashboardSummary({ data: { scope } }),
    // Switching scope keeps the figures on screen until the others arrive.
    placeholderData: keepPreviousData,
  });
