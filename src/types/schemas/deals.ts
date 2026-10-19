import { z } from "zod";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { currencyCodeSchema } from "@/types/schemas/currency";
import { fieldValuesSchema } from "@/types/schemas/fields";
import {
  SORT_DIRECTIONS,
  bulkIdsSchema,
  listInputSchema,
} from "@/types/schemas/records";

export const DEAL_SORTS = [
  "name",
  "company",
  "stage",
  "amount",
  "owner",
  "expectedCloseDate",
  "lastActivity",
  "createdAt",
  "archivedAt",
] as const;
export type DealSort = (typeof DEAL_SORTS)[number];

/** The list's status tabs: every deal, the pipeline, or the outcomes. */
export const DEAL_STATUSES = ["all", "open", "closed"] as const;

/** When a deal is expected to close, relative to today (UTC). */
export const CLOSING_WINDOWS = [
  "overdue",
  "this-month",
  "next-month",
  "later",
  "none",
] as const;
export type ClosingWindow = (typeof CLOSING_WINDOWS)[number];

export const DEAL_NAME_MAX = 200;

/** The largest amount a deal records: what the CRM's Decimal(14, 2) held. */
export const MAX_DEAL_AMOUNT = 999_999_999_999.99;

/** The deals list: newest first unless a column says otherwise. */
export const dealListSchema = listInputSchema.extend({
  sort: z.enum(DEAL_SORTS).default("createdAt"),
  dir: z.enum(SORT_DIRECTIONS).default("desc"),
  status: z.enum(DEAL_STATUSES).default("all"),
  stage: z.array(z.enum(DEAL_STAGES)).max(DEAL_STAGES.length).default([]),
  closing: z
    .array(z.enum(CLOSING_WINDOWS))
    .max(CLOSING_WINDOWS.length)
    .default([]),
});

export type DealListInput = z.infer<typeof dealListSchema>;

/** In the deal's currency; rounded to its minor unit when it's written. */
const amount = z
  .number()
  .min(0, "An amount can't be negative.")
  .max(MAX_DEAL_AMOUNT, "That amount is too large to record.");

/** A calendar day; stored as that day's UTC midnight. */
const closeDate = z.iso.date({
  error: "A close date is a day, like 2027-03-31.",
});

export const createDealSchema = z.object({
  name: z.string().trim().min(1, "A deal needs a name.").max(DEAL_NAME_MAX),
  companyId: z.string().min(1, "A deal belongs to a company."),
  ownerId: z.string().min(1, "A deal needs an owner."),
  /** A new deal is open unless it says otherwise. */
  stage: z.enum(DEAL_STAGES).optional(),
  amount: amount.nullable().optional(),
  /** Omitted: the workspace's reporting currency. */
  currency: currencyCodeSchema.optional(),
  expectedCloseDate: closeDate.nullable().optional(),
  /** Custom field values by key, written with the record. */
  fields: fieldValuesSchema.optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;

/** Only the fields given change; null clears the ones that may be empty. */
export const updateDealSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(DEAL_NAME_MAX).optional(),
  description: z.string().max(5000).nullable().optional(),
  companyId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  amount: amount.nullable().optional(),
  currency: currencyCodeSchema.optional(),
  expectedCloseDate: closeDate.nullable().optional(),
  /** Custom field values by key, written with the record. */
  fields: fieldValuesSchema.optional(),
});

export type UpdateDealInput = z.infer<typeof updateDealSchema>;

const closedReason = z.string().trim().max(2000).optional();

export const setDealStageSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(DEAL_STAGES),
  /** Why it was lost, or why it isn't a fit: required for those stages. */
  closedReason,
});

export type SetDealStageInput = z.infer<typeof setDealStageSchema>;

export const bulkDealStageSchema = bulkIdsSchema.extend({
  stage: z.enum(DEAL_STAGES),
  closedReason,
});

export const bulkDealOwnerSchema = bulkIdsSchema.extend({
  ownerId: z.string().min(1, "A deal needs an owner."),
});

/** What a person does on a deal: "Champion", "Economic buyer". */
const contactRole = z
  .string()
  .trim()
  .max(80, "That role is too long.")
  .nullable();

export const dealContactOptionsSchema = z.object({
  dealId: z.string().min(1),
});

export const attachDealContactSchema = z.object({
  dealId: z.string().min(1),
  contactId: z.string().min(1, "Choose somebody to bring onto the deal."),
  role: contactRole.optional(),
});

export type AttachDealContactInput = z.infer<typeof attachDealContactSchema>;

export const detachDealContactSchema = z.object({
  dealId: z.string().min(1),
  contactId: z.string().min(1),
});

export const dealContactRoleSchema = z.object({
  dealId: z.string().min(1),
  contactId: z.string().min(1),
  role: contactRole,
});
