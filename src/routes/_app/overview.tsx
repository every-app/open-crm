import { createFileRoute } from "@tanstack/react-router";
import {
  DashboardPage,
  dashboardSearchSchema,
} from "@/client/features/dashboard/DashboardPage";
import { dashboardSummaryQueryOptions } from "@/client/features/dashboard/dashboardQueries";
import { pageHead } from "@/client/lib/page-title";
import { queryClient } from "@/client/tanstack-db";

export const Route = createFileRoute("/_app/overview")({
  head: () => pageHead("Overview"),
  validateSearch: dashboardSearchSchema,
  // The loader fills the module-scoped query client, so keep it out of server
  // requests: one isolate must not cache another organization's figures.
  ssr: false,
  loaderDeps: ({ search }) => ({ scope: search.scope ?? "everyone" }),
  // Starts the figures on link intent (hovering Overview) and on a full load,
  // without holding up navigation.
  loader: ({ deps }) => {
    void queryClient.prefetchQuery(dashboardSummaryQueryOptions(deps.scope));
  },
  component: DashboardPage,
});
