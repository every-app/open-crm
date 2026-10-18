import { z } from "zod";
import { RECORD_SOURCES } from "@/shared/crm-enums";
import {
  ACTIVITY_WINDOWS,
  SORT_DIRECTIONS,
  bulkIdsSchema,
  facetFilterSchema,
  listInputSchema,
} from "@/types/schemas/records";

export const CONTACT_SORTS = [
  "name",
  "title",
  "email",
  "company",
  "owner",
  "lastActivity",
  "createdAt",
  "archivedAt",
] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const CONTACT_NAME_MAX = 100;
export const CONTACT_EMAIL_MAX = 320;
export const CONTACT_TITLE_MAX = 200;

/** The company filter's value for contacts who are at no company. */
export const NO_COMPANY = "none";

/** The contacts list: newest first unless a column says otherwise. */
export const contactListSchema = listInputSchema.extend({
  sort: z.enum(CONTACT_SORTS).default("createdAt"),
  dir: z.enum(SORT_DIRECTIONS).default("desc"),
  /** Company ids, and `NO_COMPANY` for contacts at none. */
  company: facetFilterSchema,
  title: facetFilterSchema,
  seniority: facetFilterSchema,
  /** The contact's function, as the original CRM's Persona filter. */
  persona: facetFilterSchema,
  activity: z.enum(ACTIVITY_WINDOWS).optional(),
  /** How they came in: the MCP tools' filter (the list page has none). */
  source: z.array(z.enum(RECORD_SOURCES)).max(RECORD_SOURCES.length).optional(),
});

export type ContactListInput = z.infer<typeof contactListSchema>;

// Text fields are written as given, trimmed; a blank one clears the field.
const text = (max: number) => z.string().max(max).optional();

export const createContactSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "A contact needs a first name.")
    .max(CONTACT_NAME_MAX),
  lastName: text(CONTACT_NAME_MAX),
  // Lowercased by the service, which refuses anything that isn't an address.
  email: text(CONTACT_EMAIL_MAX),
  phone: text(100),
  title: text(CONTACT_TITLE_MAX),
  /** Null or left out: the company behind a work email, if any. */
  companyId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().trim().min(1).max(CONTACT_NAME_MAX).optional(),
  lastName: text(CONTACT_NAME_MAX),
  email: text(CONTACT_EMAIL_MAX),
  phone: text(100),
  title: text(CONTACT_TITLE_MAX),
  linkedinUrl: text(2048),
  twitterUrl: text(2048),
  githubUrl: text(2048),
  /** Null takes the contact off their company. */
  companyId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const bulkContactCompanySchema = bulkIdsSchema.extend({
  /** Null takes the contacts off whatever company they were at. */
  companyId: z.string().min(1).nullable(),
});

/** A person settling one of the agent's suggestions about a contact. */
export const decideFactSchema = z.object({
  factId: z.string().min(1),
  decision: z.enum(["accept", "dismiss"]),
});

export type DecideFactInput = z.infer<typeof decideFactSchema>;
