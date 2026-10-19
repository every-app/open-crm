import { sortBy } from "remeda";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { rolesOf, roleRank } from "@/client/features/members/memberRoles";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { SettingsService } from "@/server/features/settings/services/SettingsService";
import { WorkspaceService } from "@/server/features/workspace/services/WorkspaceService";
import { AppError } from "@/server/lib/errors";
import { CURRENCY_CODES } from "@/shared/currency";
import { enrichmentQueueSchema } from "@/types/schemas/agent";
import {
  removeManualRateSchema,
  setManualRateSchema,
  setReportingCurrencySchema,
} from "@/types/schemas/currency";
import { MEMBER_ROLES, MEMBER_SORTS } from "@/types/schemas/members";
import { SORT_DIRECTIONS } from "@/types/schemas/records";
import { setArchiveRetentionSchema } from "@/types/schemas/settings";
import { updateWorkspaceSchema } from "@/types/schemas/workspace";

// The workspace around the records: its name and website, how long it keeps
// archived records, its members, its currencies and the research agent's
// queue. Changing the workspace and its currencies is for owners and admins,
// as in Settings. Members, roles and invitations themselves are the Every App
// gateway's.

const workspaceOutput = z.object({
  name: z.string(),
  website: z.string().nullable(),
  caller: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .describe("Who these tools act as."),
  role: z.string().describe("The caller's role: owner, admin or member."),
  archiveRetentionDays: z
    .number()
    .describe(
      "Archived companies, contacts and deals are deleted for good this many days after they were archived.",
    ),
});

/** The workspace as the tools show it to `context`. */
async function workspace(
  context: Pick<EnsuredUserContext, "organizationId" | "userId" | "role">,
) {
  const [details, retention, [caller]] = await Promise.all([
    WorkspaceService.getWorkspace(context.organizationId),
    SettingsService.getArchiveRetention(context.organizationId),
    AuthRepository.getUsers([context.userId]),
  ]);
  if (!caller) throw new Error("The caller has no user row");
  return {
    ...details,
    caller,
    role: context.role,
    archiveRetentionDays: retention.days,
  };
}

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

type Member = Awaited<ReturnType<typeof AuthRepository.listMembers>>[number];

/** How Settings → Members sorts its columns. */
const MEMBER_ORDER: Record<
  (typeof MEMBER_SORTS)[number],
  (member: Member) => string | number
> = {
  name: (member) => member.name.toLowerCase(),
  email: (member) => member.email.toLowerCase(),
  role: roleRank,
  joinedAt: (member) => member.joinedAt,
};

const subjectOutput = z.object({
  kind: z.enum(["company", "contact", "deal"]),
  id: z.string(),
  name: z.string(),
});

export const workspaceTools = {
  get_workspace: crmTool({
    description:
      "The workspace this CRM belongs to: the company's name and website, who the caller is and their role in it, and how long archived records are kept.",
    risk: "read",
    input: z.object({}).strict(),
    output: workspaceOutput,
    handler: (_input, context) => workspace(context),
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
      await WorkspaceService.updateWorkspace(
        context.organizationId,
        changed.data,
      );
      return workspace(context);
    },
  }),

  set_archive_retention: crmTool({
    description:
      "How many days archived companies, contacts and deals are kept before the daily purge deletes them for good (owners and admins only). A shorter time deletes the ones archived longer ago at the next purge.",
    risk: "destructive",
    input: z
      .object({
        days: setArchiveRetentionSchema.shape.days.describe("From 1 to 3,650."),
      })
      .strict(),
    output: workspaceOutput,
    handler: async ({ days }, context) => {
      requireOrgPermission(context, manage);
      await SettingsService.setArchiveRetention(context.organizationId, days);
      return workspace(context);
    },
  }),

  list_members: crmTool({
    description:
      "The organization's members who have opened the CRM, with their roles: the people records can be owned by and tools take by email. `query` matches part of a name or email. 50 a page, oldest first unless sorted.",
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("Part of a member's name or email."),
        roles: z
          .array(z.enum(MEMBER_ROLES))
          .max(MEMBER_ROLES.length)
          .optional()
          .describe("Only members with any of these roles."),
        sort: z
          .enum(MEMBER_SORTS)
          .optional()
          .describe("joinedAt unless said; role puts owners first."),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: pageInput,
      })
      .strict(),
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
          isCaller: z.boolean().describe("This member is the caller."),
        }),
      ),
    }),
    handler: async (input, context) => {
      const needle = input.query?.toLowerCase() ?? "";
      const roles: readonly string[] = input.roles ?? [];
      const found = (
        await AuthRepository.listMembers(context.organizationId)
      ).filter(
        (member) =>
          (!needle ||
            member.name.toLowerCase().includes(needle) ||
            member.email.toLowerCase().includes(needle)) &&
          (roles.length === 0 ||
            rolesOf(member).some((role) => roles.includes(role))),
      );
      const { rows, ...rest } = pageOf(
        sortBy(found, [
          MEMBER_ORDER[input.sort ?? "joinedAt"],
          input.direction ?? "asc",
        ]),
        input.page ?? 1,
        MEMBERS_PAGE,
      );
      return {
        ...rest,
        members: rows.map((row) => ({
          ...row,
          isCaller: row.userId === context.userId,
        })),
      };
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
