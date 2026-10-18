import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { AppError } from "@/server/lib/errors";
import { CURRENCY_CODES } from "@/shared/currency";
import { enrichmentQueueSchema } from "@/types/schemas/agent";
import {
  removeManualRateSchema,
  setManualRateSchema,
  setReportingCurrencySchema,
} from "@/types/schemas/currency";
import { updateWorkspaceSchema } from "@/types/schemas/workspace";

// The workspace around the records: its name and website, its members, its
// currencies and the research agent's queue. Changing the workspace and its
// currencies is for owners and admins, as in Settings. Members, roles and
// invitations themselves are the Every App gateway's.

const workspaceOutput = z.object({
  name: z.string(),
  website: z.string().nullable(),
  role: z.string().describe("The caller's role: owner, admin or member."),
});

const currencyOutput = z.object({
  reportingCurrency: z.string(),
  refreshedAt: z.string().nullable(),
  rates: z
    .array(
      z.object({
        currency: z.string(),
        rate: z
          .number()
          .describe("Units of the reporting currency one unit buys."),
        asOf: z.string(),
        source: z.enum(["FETCHED", "MANUAL"]),
      }),
    )
    .describe("The rate each currency converts at; a manual one wins."),
  inUse: z
    .array(
      z.object({
        currency: z.string(),
        deals: z.number(),
        convertible: z.boolean(),
      }),
    )
    .describe("The currencies deals are in, most used first."),
  unconverted: z
    .object({ count: z.number(), currencies: z.array(z.string()) })
    .describe("Deals left out of totals for want of a rate."),
});

const currency = setReportingCurrencySchema.shape.currency.describe(
  `A currency code: ${CURRENCY_CODES.join(", ")}.`,
);

const manage = { workspace: ["manage" as const] };

const MEMBERS_PAGE = 50;

const subjectOutput = z.object({
  kind: z.enum(["company", "contact", "deal"]),
  id: z.string(),
  name: z.string(),
});

export const workspaceTools = {
  get_workspace: crmTool({
    description:
      "The workspace this CRM belongs to: the company's name and website, and the caller's role in it.",
    risk: "read",
    input: z.object({}).strict(),
    output: workspaceOutput,
    handler: async (_input, context) => ({
      ...(await WorkspaceService.getWorkspace(context.organizationId)),
      role: context.role,
    }),
  }),

  update_workspace: crmTool({
    description:
      "Rename the workspace or change its website (owners and admins only); only what is given changes. A new website sends the research agent to learn the business.",
    risk: "write",
    input: z
      .object({
        name: updateWorkspaceSchema.shape.name.optional(),
        website: updateWorkspaceSchema.shape.website
          .optional()
          .describe("The domain, like acme.com."),
      })
      .strict(),
    output: workspaceOutput,
    handler: async (input, context) => {
      requireOrgPermission(context, manage);
      const current = await WorkspaceService.getWorkspace(
        context.organizationId,
      );
      const changed = updateWorkspaceSchema.safeParse({
        name: input.name ?? current.name,
        website: input.website ?? current.website,
      });
      if (!changed.success) {
        throw new AppError(
          "VALIDATION_ERROR",
          "The workspace has no website yet: give one.",
        );
      }
      return {
        ...(await WorkspaceService.updateWorkspace(
          context.organizationId,
          changed.data,
        )),
        role: context.role,
      };
    },
  }),

  list_members: crmTool({
    description:
      "The organization's members who have opened the CRM, with their roles: the people records can be owned by and tools take by email. 50 a page, oldest first.",
    risk: "read",
    input: z.object({ page: pageInput }).strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      members: z.array(
        z.object({
          name: z.string(),
          email: z.string(),
          role: z.string(),
          joinedAt: z.string(),
        }),
      ),
    }),
    handler: async ({ page }, context) => {
      const { rows, ...rest } = pageOf(
        await AuthRepository.listMembers(context.organizationId),
        page ?? 1,
        MEMBERS_PAGE,
      );
      return { ...rest, members: rows };
    },
  }),

  get_currency_settings: crmTool({
    description:
      "The currency totals are reported in, the rate each other currency converts at (fetched daily, or set by hand), the currencies deals are in, and how many deals no rate converts.",
    risk: "read",
    input: z.object({}).strict(),
    output: currencyOutput,
    handler: (_input, context) =>
      CurrencyService.getSettings(context.organizationId),
  }),

  set_reporting_currency: crmTool({
    description:
      "Report every total in another currency (owners and admins only): its rates are fetched and every deal is converted again, so reported figures move.",
    risk: "write",
    input: z.object({ currency }).strict(),
    output: currencyOutput,
    handler: (input, context) => {
      requireOrgPermission(context, manage);
      return CurrencyService.setReportingCurrency(
        context.organizationId,
        input.currency,
      );
    },
  }),

  set_exchange_rate: crmTool({
    description:
      "Set a currency's rate by hand (owners and admins only): units of the reporting currency one unit buys. It wins over the fetched rate; deals no rate converted yet are converted at it.",
    risk: "write",
    input: z
      .object({ currency, rate: setManualRateSchema.shape.rate })
      .strict(),
    output: currencyOutput,
    handler: (input, context) => {
      requireOrgPermission(context, manage);
      return CurrencyService.setManualRate(
        context.organizationId,
        input.currency,
        input.rate,
      );
    },
  }),

  remove_exchange_rate: crmTool({
    description:
      "Drop a currency's hand-set rate (owners and admins only); the fetched rate applies again.",
    risk: "write",
    input: z
      .object({ currency: removeManualRateSchema.shape.currency })
      .strict(),
    output: currencyOutput,
    handler: (input, context) => {
      requireOrgPermission(context, manage);
      return CurrencyService.removeManualRate(
        context.organizationId,
        input.currency,
      );
    },
  }),

  refresh_exchange_rates: crmTool({
    description:
      "Fetch today's exchange rates now and convert the deals no rate converted yet (owners and admins only).",
    risk: "write",
    input: z.object({}).strict(),
    output: currencyOutput,
    handler: (_input, context) => {
      requireOrgPermission(context, manage);
      return CurrencyService.refreshRates(context.organizationId);
    },
  }),

  get_enrichment_queue: crmTool({
    description:
      "What the research agent is doing for the organization: its tasks running, waiting or out of attempts (most urgent first) and the research booked for later, with totals. `paused` when its model isn't set up or credits ran out.",
    risk: "read",
    input: z
      .object({
        limit: enrichmentQueueSchema.shape.limit
          .optional()
          .describe("How many of each list, 20 unless said (at most 200)."),
      })
      .strict(),
    output: z.object({
      paused: z.boolean(),
      total: z.number(),
      rows: z.array(
        z.object({
          kind: z.string(),
          state: z.enum(["running", "queued", "failed", "waiting", "credits"]),
          startedAt: z.string().nullable(),
          subject: subjectOutput,
        }),
      ),
      scheduledTotal: z.number(),
      scheduled: z.array(
        z.object({
          kind: z.string(),
          dueAt: z.string(),
          reason: z.string().nullable(),
          subject: subjectOutput,
        }),
      ),
    }),
    handler: ({ limit }, context) =>
      EnrichmentQueueService.queue(
        context.organizationId,
        enrichmentQueueSchema.parse({ limit }).limit,
      ),
  }),
};
