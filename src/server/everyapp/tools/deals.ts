import { z } from "zod";
import { crmTool, memberId } from "@/server/everyapp/crm-tool";
import {
  fieldFiltersInput,
  resolveFieldFilters,
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

function fullName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

/** The amount in the reporting currency, when a rate converted it. */
function reported(
  deal: { baseAmount: number | null; baseCurrency: string | null },
  reportingCurrency: string,
) {
  return deal.baseAmount !== null && deal.baseCurrency === reportingCurrency
    ? { amount: deal.baseAmount, currency: reportingCurrency }
    : null;
}

function summary(row: DealListRow, reportingCurrency: string) {
  return {
    id: row.id,
    name: row.name,
    company: { id: row.company.id, name: row.company.name },
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    inReportingCurrency: reported(row, reportingCurrency),
    owner: { name: row.owner.name, email: row.owner.email },
    expectedCloseDate: day(row.expectedCloseDate),
    closedAt: row.closedAt,
    lastActivityAt: row.lastActivityAt,
    archivedAt: row.archivedAt,
    fields: row.fields,
  };
}

function details(deal: DealDetail) {
  return {
    id: deal.id,
    name: deal.name,
    description: deal.description,
    company: {
      id: deal.company.id,
      name: deal.company.name,
      domain: deal.company.domain,
      industry: deal.company.industry,
    },
    owner: { name: deal.owner.name, email: deal.owner.email },
    stage: deal.stage,
    stageChangedAt: deal.stageChangedAt,
    closedAt: deal.closedAt,
    closedReason: deal.closedReason,
    amount: deal.amount,
    currency: deal.currency,
    inReportingCurrency: reported(deal, deal.reportingCurrency),
    exchangeRate: deal.fxRate,
    exchangeRateAsOf: deal.fxRateAt,
    expectedCloseDate: day(deal.expectedCloseDate),
    contacts: deal.contacts.map((contact) => ({
      id: contact.id,
      name: fullName(contact),
      role: contact.role,
      title: contact.title,
      email: contact.email,
    })),
    lastActivityAt: deal.lastActivityAt,
    createdAt: deal.createdAt,
    archivedAt: deal.archivedAt,
  };
}

const dealId = z.string().min(1).describe("The deal's id, from list_deals.");

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

export const dealTools = {
  list_deals: crmTool({
    description: `Search and list the CRM's deals: company, stage, amount and currency, owner and expected close date. \`query\` matches part of the deal's or its company's name; \`fields\` filters by custom fields, and each deal comes with the values of the fields shown as table columns (a select as its label). With the page comes the open pipeline's value in the reporting currency, and how many open deals it leaves out because no exchange rate converts their currency. ${STAGES_NOTE} 25 a page, newest first unless sorted.`,
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
            'When deals are expected to close: "overdue" (open deals past their day), "this-month", "next-month", "later", or "none" (no date).',
          ),
        archived: z
          .boolean()
          .optional()
          .describe("List archived deals instead of live ones."),
        fields: fieldFiltersInput,
        sort: z.enum(DEAL_SORTS).optional(),
        direction: z.enum(SORT_DIRECTIONS).optional(),
        page: z.number().int().min(1).optional(),
      })
      .strict(),
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
        dir: input.direction,
        page: input.page,
      });
      const result = await DealService.listDeals(context.organizationId, list);
      return {
        total: result.total,
        page: list.page,
        pageSize: list.pageSize,
        openPipeline: {
          value: result.openValue,
          currency: result.reportingCurrency,
          notCounted: result.unconverted,
        },
        deals: result.rows.map((row) => summary(row, result.reportingCurrency)),
      };
    },
  }),

  get_deal: crmTool({
    description:
      "One deal in full: its company, owner, stage and when it last moved, why it closed, its amount (and that amount in the reporting currency), and the people on it with their roles.",
    risk: "read",
    input: z.object({ id: dealId }).strict(),
    handler: async ({ id }, context) =>
      details(await DealService.getDeal(context.organizationId, id)),
  }),

  create_deal: crmTool({
    description: `Add a deal to a company (get its id from list_companies). The owner defaults to you; the currency to the workspace's reporting currency. A new deal starts at DEMO_BOOKED unless \`stage\` says otherwise. ${STAGES_NOTE}`,
    risk: "write",
    input: createDealSchema
      .omit({ ownerId: true })
      .extend({ ...dealFields, ownerEmail: ownerEmail.optional() })
      .strict(),
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
      "Change a deal's details. Only the fields given change; null clears the amount, description or close date. A new amount or currency is converted into the reporting currency at today's rate. Move its stage with set_deal_stage.",
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
    handler: async ({ ownerEmail: email, ...input }, context) =>
      DealService.updateDeal(context.organizationId, {
        ...input,
        ownerId: email
          ? await memberId(context.organizationId, email)
          : undefined,
      }),
  }),

  set_deal_stage: crmTool({
    description: `Move a deal to another stage; the move goes on the deal's timeline. Moving to CLOSED_LOST or UNQUALIFIED_TO_BUY takes a \`closedReason\`. ${STAGES_NOTE}`,
    risk: "write",
    input: setDealStageSchema
      .extend({
        id: dealId,
        closedReason: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Why it was lost, or why it isn't a fit: what it was lost to, budget, timing.",
          ),
      })
      .strict(),
    handler: (input, context) =>
      DealService.setStage(context.organizationId, input, context.userId),
  }),

  add_deal_contact: crmTool({
    description:
      "Put someone who works at the deal's company on the deal, optionally with their role on it (Champion, Economic buyer). Someone already on it gets the new role.",
    risk: "write",
    input: attachDealContactSchema
      .extend({
        dealId,
        contactId: z
          .string()
          .min(1)
          .describe("The contact's id; get_company lists who works there."),
      })
      .strict(),
    handler: (input, context) =>
      DealService.attachContact(context.organizationId, input),
  }),

  remove_deal_contact: crmTool({
    description: "Take someone off a deal. The contact stays in the CRM.",
    risk: "write",
    input: detachDealContactSchema
      .extend({
        dealId,
        contactId: z
          .string()
          .min(1)
          .describe("The contact's id, from get_deal."),
      })
      .strict(),
    handler: ({ dealId: id, contactId }, context) =>
      DealService.detachContact(context.organizationId, id, contactId),
  }),

  archive_deal: crmTool({
    description:
      "Archive a deal: it leaves every list and every pipeline total. A person can restore it from the Archived view.",
    risk: "destructive",
    input: z.object({ id: dealId }).strict(),
    handler: ({ id }, context) =>
      DealService.archiveDeal(context.organizationId, id),
  }),
};
