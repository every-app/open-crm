import { createFileRoute } from "@tanstack/react-router";
import {
  DashboardPage,
  dashboardSearchSchema,
} from "@/client/features/dashboard/DashboardPage";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/")({
  head: () => pageHead("Overview"),
  validateSearch: dashboardSearchSchema,
  component: DashboardPage,
});
