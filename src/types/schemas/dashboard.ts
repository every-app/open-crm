import { z } from "zod";

/** Whose numbers Home shows: the viewer's own deals, or the whole team's. */
export const DASHBOARD_SCOPES = ["me", "everyone"] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

export const dashboardSummarySchema = z.object({
  scope: z.enum(DASHBOARD_SCOPES).default("me"),
});
