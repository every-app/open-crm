import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { enrichmentQueueSchema } from "@/types/schemas/agent";

export const workspaceTools = {
  get_workspace: crmTool({
    description:
      "The workspace this CRM belongs to: the company's name and website.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, context) =>
      WorkspaceService.getWorkspace(context.organizationId),
  }),

  get_currency_settings: crmTool({
    description:
      "The currency totals are reported in, the exchange rate from each other currency into it (fetched daily, or set by hand) and how many deals are in each currency, with any that have no rate and so are left out of totals.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, context) =>
      CurrencyService.getSettings(context.organizationId),
  }),

  get_enrichment_queue: crmTool({
    description:
      "What the research agent is doing for the organization: the tasks running, waiting or out of attempts (most urgent first, with totals) and the research booked for later.",
    risk: "read",
    input: z
      .object({ limit: enrichmentQueueSchema.shape.limit.optional() })
      .strict(),
    handler: ({ limit }, context) =>
      EnrichmentQueueService.queue(
        context.organizationId,
        enrichmentQueueSchema.parse({ limit }).limit,
      ),
  }),
};
