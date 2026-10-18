import { z } from "zod";
import {
  crmTool,
  personOutput,
  recordRefOutput,
} from "@/server/everyapp/crm-tool";
import {
  activityOutput,
  toolActivity,
} from "@/server/everyapp/tools/activities";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { DASHBOARD_SCOPES } from "@/types/schemas/dashboard";

const total = z.object({ count: z.number(), value: z.number() });

export const dashboardTools = {
  get_sales_summary: crmTool({
    description:
      "Home's sales summary in the reporting currency: open pipeline by stage, closing this month, won this month and last, win rate, average deal and cycle over 90 days, a six-month trend, the biggest open deals, overdue tasks and recent activity. scope: me (the caller's deals, the default) or everyone.",
    risk: "read",
    input: z.object({ scope: z.enum(DASHBOARD_SCOPES).optional() }).strict(),
    output: z.object({
      scope: z.enum(DASHBOARD_SCOPES),
      reportingCurrency: z.string(),
      unconverted: z
        .object({ count: z.number(), currencies: z.array(z.string()) })
        .describe("Deals left out of the money for want of a rate."),
      pipeline: z.object({
        stages: z.array(
          z.object({
            stage: z.enum(DEAL_STAGES),
            count: z.number(),
            value: z.number(),
          }),
        ),
        total: z.number(),
        count: z.number(),
      }),
      closingThisMonth: total,
      wonThisMonth: total,
      wonLastMonth: total,
      performance: z.object({
        windowDays: z.number(),
        wins: z.number(),
        losses: z.number(),
        winRate: z.number().nullable(),
        averageDeal: z.number().nullable(),
        averageCycleDays: z.number().nullable(),
      }),
      trend: z.array(
        z.object({ month: z.string(), won: z.number(), created: z.number() }),
      ),
      biggestOpen: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          stage: z.enum(DEAL_STAGES),
          amount: z.number().nullable(),
          currency: z.string(),
          valueInReportingCurrency: z.number().nullable(),
          expectedCloseDate: z.string().nullable(),
          inStageSince: z.string().nullable(),
          company: recordRefOutput,
          owner: personOutput,
        }),
      ),
      overdueTasks: z.array(activityOutput),
      recentActivity: z.array(activityOutput),
    }),
    handler: async ({ scope }, context) => {
      const summary = await DashboardService.summary(
        context.organizationId,
        context.userId,
        scope ?? "me",
      );
      return {
        ...summary,
        biggestOpen: summary.biggestOpen.map((deal) => ({
          ...deal,
          valueInReportingCurrency: deal.baseAmount,
          inStageSince: deal.stageChangedAt,
        })),
        overdueTasks: summary.overdueTasks.map(toolActivity),
        recentActivity: summary.recentActivity.map(toolActivity),
      };
    },
  }),
};
