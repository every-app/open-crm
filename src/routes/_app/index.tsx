import { createFileRoute } from "@tanstack/react-router";
import {
  DashboardPage,
  dashboardSearchSchema,
} from "@/client/features/dashboard/DashboardPage";

export const Route = createFileRoute("/_app/")({
  validateSearch: dashboardSearchSchema,
  component: DashboardPage,
});
