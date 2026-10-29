import { z } from "zod";
import { RECORD_SOURCES } from "@/shared/crm-enums";
import { fieldValuesSchema } from "@/types/schemas/fields";
import {
  ACTIVITY_WINDOWS,
  SORT_DIRECTIONS,
  facetFilterSchema,
  listInputSchema,
} from "@/types/schemas/records";

export const COMPANY_SORTS = [
  "name",
  "domain",
  "industry",
  "owner",
  "contacts",
  "deals",
  "lastActivity",
  "createdAt",
  "archivedAt",
] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export const COMPANY_NAME_MAX = 200;

/** The companies list: newest first unless a column says otherwise. */
export const companyListSchema = listInputSchema.extend({
  sort: z.enum(COMPANY_SORTS).default("createdAt"),
  dir: z.enum(SORT_DIRECTIONS).default("desc"),
  industry: facetFilterSchema,
  activity: z.enum(ACTIVITY_WINDOWS).optional(),
  /** How they came in: the MCP tools' filter (the list page has none). */
  source: z.array(z.enum(RECORD_SOURCES)).max(RECORD_SOURCES.length).optional(),
});

export type CompanyListInput = z.infer<typeof companyListSchema>;

export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A company needs a name.")
    .max(COMPANY_NAME_MAX),
  // A domain or a website; the service reduces it to the bare host and
  // refuses anything else.
  domain: z.string().trim().max(255).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  /** Custom field values by key, written with the record. */
  fields: fieldValuesSchema.optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

// Text fields are written as given, trimmed; a blank one clears the field.
const text = (max: number) => z.string().max(max).optional();

export const updateCompanySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(COMPANY_NAME_MAX).optional(),
  domain: text(255),
  website: text(2048),
  description: text(5000),
  industry: text(200),
  city: text(200),
  stateCode: text(100),
  country: text(200),
  phone: text(100),
  email: text(320),
  linkedinUrl: text(2048),
  ownerId: z.string().min(1).nullable().optional(),
  /** Custom field values by key, written with the record. */
  fields: fieldValuesSchema.optional(),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const companyOptionsSchema = z.object({
  q: z.string().trim().max(200).default(""),
});

export const setPrimaryContactSchema = z.object({
  companyId: z.string().min(1),
  /** Null leaves the company without a primary contact. */
  contactId: z.string().min(1).nullable(),
});
