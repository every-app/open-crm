import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { toolActivity } from "@/server/everyapp/tools/activities";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { DASHBOARD_SCOPES } from "@/types/schemas/dashboard";

export const dashboardTools = {
  get_sales_summary: crmTool({
    description:
      "Home's sales summary, in the workspace's reporting currency: the open pipeline by stage, what is due to close this month, deals won this month and last, the win rate, average deal and sales cycle over 90 days, a six-month trend of won and new pipeline, the biggest open deals, the caller's overdue tasks and the latest activity. Deals in a currency with no rate are left out of the money and counted in `unconverted`. scope: me (the caller's own deals, the default) or everyone.",
    risk: "read",
    input: z.object({ scope: z.enum(DASHBOARD_SCOPES).optional() }).strict(),
    handler: async ({ scope }, context) => {
      const summary = await DashboardService.summary(
        context.organizationId,
        context.userId,
        scope ?? "me",
      );
      return {
        ...summary,
        biggestOpen: summary.biggestOpen.map((deal) => ({
          id: deal.id,
          name: deal.name,
          stage: deal.stage,
          amount: deal.amount,
          currency: deal.currency,
          valueInReportingCurrency: deal.baseAmount,
          expectedCloseDate: deal.expectedCloseDate,
          inStageSince: deal.stageChangedAt,
          company: { id: deal.company.id, name: deal.company.name },
          owner: { name: deal.owner.name, email: deal.owner.email },
        })),
        overdueTasks: summary.overdueTasks.map(toolActivity),
        recentActivity: summary.recentActivity.map(toolActivity),
      };
    },
  }),
};
