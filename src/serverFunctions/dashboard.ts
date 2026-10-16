import { createServerFn } from "@tanstack/react-start";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { dashboardSummarySchema } from "@/types/schemas/dashboard";

export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(dashboardSummarySchema)
  .handler(({ data, context }) =>
    DashboardService.summary(
      context.organizationId,
      context.userId,
      data.scope,
    ),
  );
