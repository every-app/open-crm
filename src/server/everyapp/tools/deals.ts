import { mapValues } from "remeda";
import { z } from "zod";
import {
  crmTool,
  fullName,
  memberId,
  pageSizeInput,
  personOutput,
  recordRefOutput,
} from "@/server/everyapp/crm-tool";
import {
  fieldColumnsOutput,
  fieldFiltersInput,
  resolveFieldFilters,
  userFieldsByEmail,
} from "@/server/everyapp/tools/fieldFilters";
import {
  DealService,
  type DealDetail,
  type DealListRow,
} from "@/server/features/deals/services/DealService";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { CURRENCY_CODES } from "@/shared/currency";
import { OPEN_DEAL_STAGES } from "@/shared/deal-stages";
import {
  CLOSING_WINDOWS,
  DEAL_SORTS,
  DEAL_STATUSES,
  attachDealContactSchema,
  createDealSchema,
  dealContactRoleSchema,
  dealListSchema,
  detachDealContactSchema,
  setDealStageSchema,
  updateDealSchema,
} from "@/types/schemas/deals";
import { SORT_DIRECTIONS } from "@/types/schemas/records";

// The deals (the pipeline) as an AI client sees them. People are named by
// email here, as a model knows them; the app's own forms use member ids.

const STAGES_NOTE = `Stages in pipeline order: ${OPEN_DEAL_STAGES.join(", ")} are open; CLOSED_WON, CLOSED_LOST and UNQUALIFIED_TO_BUY are outcomes.`;

/** A close date as written: its day. */
function day(value: string | null) {
  return value ? value.slice(0, 10) : null;
}

const reportedOutput = z
  .object({ amount: z.number(), currency: z.string() })
  .nullable()
  .describe("The amount in the reporting currency, when a rate converts it.");

/** The amount in the reporting currency, when a rate converted it. */
function reported(
  deal: { baseAmount: number | null; baseCurrency: string | null },
  reportingCurrency: string,
) {
  return deal.baseAmount !== null && deal.baseCurrency === reportingCurrency
    ? { amount: deal.baseAmount, currency: reportingCurrency }
    : null;
}

const summaryOutput = z.object({
  id: z.string(),
  name: z.string(),
  company: recordRefOutput,
  stage: z.enum(DEAL_STAGES),
  amount: z.number().nullable(),
  currency: z.string(),
  inReportingCurrency: reportedOutput,
  owner: personOutput,
  expectedCloseDate: z.string().nullable(),
  closedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  fields: fieldColumnsOutput,
});

function summary(
  row: DealListRow,
  reportingCurrency: string,
  shown: Awaited<ReturnType<typeof userFieldsByEmail>>,
): z.input<typeof summaryOutput> {
  return {
    ...row,
    inReportingCurrency: reported(row, reportingCurrency),
    expectedCloseDate: day(row.expectedCloseDate),
    fields: mapValues(row.fields, (value, key) => shown(key, value)),
  };
}

const detailsOutput = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  company: z.object({
    id: z.string(),
    name: z.string(),
    domain: z.string().nullable(),
    industry: z.string().nullable(),
  }),
  owner: personOutput,
  stage: z.enum(DEAL_STAGES),
  stageChangedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedReason: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  inReportingCurrency: reportedOutput,
  exchangeRate: z.number().nullable(),
  exchangeRateAsOf: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string().nullable(),
      title: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

function details(deal: DealDetail): z.input<typeof detailsOutput> {
  return {
    ...deal,
    inReportingCurrency: reported(deal, deal.reportingCurrency),
    exchangeRate: deal.fxRate,
    exchangeRateAsOf: deal.fxRateAt,
    expectedCloseDate: day(deal.expectedCloseDate),
    contacts: deal.contacts.map((contact) => ({
      ...contact,
      name: fullName(contact),
    })),
  };
}

const dealId = z
  .string()
  .min(1)
  .describe("The deal's id, from list_deals or search_records.");

const contactIdOn = (from: string) =>
  z.string().min(1).describe(`The contact's id, from ${from}.`);

const ownerEmail = z
  .string()
  .email()
  .describe("The email of the member who owns the deal.");

// What the create and update tools say about a deal's fields.
const dealFields = {
  companyId: z
    .string()
    .min(1)
    .describe("The id of the company it is sold to, from list_companies."),
  amount: createDealSchema.shape.amount.describe(
    "What the customer pays, in the deal's currency.",
  ),
  currency: createDealSchema.shape.currency.describe(
    `The amount's currency: ${CURRENCY_CODES.join(", ")}.`,
  ),
  expectedCloseDate: createDealSchema.shape.expectedCloseDate.describe(
    "The day it is expected to close, like 2027-03-31.",
  ),
};

const stageMoveOutput = z.object({
  id: z.string(),
  stage: z.enum(DEAL_STAGES),
  changed: z.boolean().describe("False when the deal was already there."),
});

export const dealTools = {
  list_deals: crmTool({
    description: `Search and list deals with their company, stage, amount, owner and expected close date, and the custom fields shown as table columns. \`query\` matches part of the deal's or its company's name. Each page comes with the open pipeline's value in the reporting currency. ${STAGES_NOTE} 25 a page unless pageSize says, newest first unless sorted.`,
    risk: "read",
    input: z
      .object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Part of a deal's name or of its company's name."),
        owners: z
          .array(z.string())
          .max(20)
          .optional()
          .describe("Only deals these members own, by email."),
        status: z
          .enum(DEAL_STATUSES)
          .optional()
          .describe('"open" for the pipeline, "closed" for outcomes.'),
        stages: z.array(z.enum(DEAL_STAGES)).max(DEAL_STAGES.length).optional(),
        closing: z
          .array(z.enum(CLOSING_WINDOWS))
          .max(CLOSING_WINDOWS.length)
          .optional()
          .describe(
            'When they are expected to close: "overdue" (open, past their day), "this-month", "next-month", "later" or "none" (no date).',
          ),
        archived: z
          .boolean()
          .optional()
          .describe("List archived deals instead of live ones."),
        fields: fieldFiltersInput,
        sort: z.enum(DEAL_SORTS).optional(),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: pageSizeInput,
      })
      .strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      openPipeline: z.object({
        value: z.number().nullable(),
        currency: z.string(),
        notCounted: z
          .object({ count: z.number(), currencies: z.array(z.string()) })
          .describe("Open deals no exchange rate converts."),
      }),
      deals: z.array(summaryOutput),
    }),
    handler: async (input, context) => {
      const owners = await Promise.all(
        (input.owners ?? []).map((email) =>
          memberId(context.organizationId, email),
        ),
      );
      const list = dealListSchema.parse({
        fields: await resolveFieldFilters(
          context.organizationId,
          "DEAL",
          input.fields,
        ),
        q: input.query,
        owner: owners,
        status: input.status,
        stage: input.stages,
        closing: input.closing,
        archived: input.archived,
        sort: input.sort,
        // As the list pages: a chosen sort runs ascending unless said.
        dir: input.direction ?? (input.sort ? "asc" : undefined),
        page: input.page,
        pageSize: input.pageSize,
      });
      const [result, shown] = await Promise.all([
        DealService.listDeals(context.organizationId, list),
        userFieldsByEmail(context.organizationId, "DEAL"),
      ]);
      return {
        total: result.total,
        page: list.page,
        pageSize: list.pageSize,
        openPipeline: {
          value: result.openValue,
          currency: result.reportingCurrency,
          notCounted: result.unconverted,
        },
        deals: result.rows.map((row) =>
          summary(row, result.reportingCurrency, shown),
        ),
      };
    },
  }),

  get_deal: crmTool({
    description:
      "One deal in full: its company, owner, stage and when it last moved, why it closed, its amount (and in the reporting currency), and the people on it with their roles.",
    risk: "read",
    input: z.object({ id: dealId }).strict(),
    output: detailsOutput,
    handler: async ({ id }, context) =>
      details(await DealService.getDeal(context.organizationId, id)),
  }),

  create_deal: crmTool({
    description: `Add a deal to a company. The owner defaults to you, the currency to the reporting currency, the stage to DEMO_BOOKED. ${STAGES_NOTE}`,
    risk: "write",
    input: createDealSchema
      .omit({ ownerId: true })
      .extend({ ...dealFields, ownerEmail: ownerEmail.optional() })
      .strict(),
    output: recordRefOutput,
    handler: async ({ ownerEmail: email, ...input }, context) =>
      DealService.createDeal(context.organizationId, {
        ...input,
        ownerId: email
          ? await memberId(context.organizationId, email)
          : context.userId,
      }),
  }),

  update_deal: crmTool({
    description:
      "Change a deal's details. Only the fields given change; null clears the amount, description or close date. A new amount or currency is converted at today's rate. Move its stage with set_deal_stage.",
    risk: "write",
    input: updateDealSchema
      .omit({ ownerId: true })
      .extend({
        ...dealFields,
        id: dealId,
        companyId: dealFields.companyId.optional(),
        ownerEmail: ownerEmail.optional(),
      })
      .strict(),
    output: recordRefOutput,
    handler: async ({ ownerEmail: email, ...input }, context) =>
      DealService.updateDeal(context.organizationId, {
        ...input,
        ownerId: email
          ? await memberId(context.organizationId, email)
          : undefined,
      }),
  }),

  set_deal_stage: crmTool({
    description: `Move a deal to another stage; the move goes on its timeline. CLOSED_LOST and UNQUALIFIED_TO_BUY take a closedReason. ${STAGES_NOTE}`,
    risk: "write",
    input: setDealStageSchema
      .extend({
        id: dealId,
        closedReason: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Why it was lost or isn't a fit: what it was lost to, budget, timing.",
          ),
      })
      .strict(),
    output: stageMoveOutput,
    handler: (input, context) =>
      DealService.setStage(context.organizationId, input, context.userId),
  }),

  add_deal_contact: crmTool({
    description:
      "Put someone who works at the deal's company on the deal, optionally with their role (Champion, Economic buyer). Someone already on it gets the new role; set_deal_contact_role clears one.",
    risk: "write",
    input: attachDealContactSchema
      .extend({
        dealId,
        contactId: contactIdOn("get_company, which lists who works there"),
      })
      .strict(),
    output: z.object({
      dealId: z.string(),
      contactId: z.string(),
    }),
    handler: (input, context) =>
      DealService.attachContact(context.organizationId, input),
  }),

  set_deal_contact_role: crmTool({
    description:
      "Change the role of someone on a deal (Champion, Economic buyer), or clear it with null.",
    risk: "write",
    input: dealContactRoleSchema
      .extend({ dealId, contactId: contactIdOn("get_deal") })
      .strict(),
    output: z.object({
      dealId: z.string(),
      contactId: z.string(),
      role: z.string().nullable(),
    }),
    handler: (input, context) =>
      DealService.setContactRole(context.organizationId, input),
  }),

  remove_deal_contact: crmTool({
    description: "Take someone off a deal. The contact stays in the CRM.",
    risk: "write",
    input: detachDealContactSchema
      .extend({ dealId, contactId: contactIdOn("get_deal") })
      .strict(),
    output: z.object({ dealId: z.string(), contactId: z.string() }),
    handler: ({ dealId: id, contactId }, context) =>
      DealService.detachContact(context.organizationId, id, contactId),
  }),

  archive_deal: crmTool({
    description:
      "Archive a deal: it leaves every list and pipeline total. bulk_restore brings it back.",
    risk: "write",
    input: z.object({ id: dealId }).strict(),
    output: recordRefOutput,
    handler: ({ id }, context) =>
      DealService.archiveDeal(context.organizationId, id),
  }),
};
