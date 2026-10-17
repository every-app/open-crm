import { z } from "zod";
import {
  SHARED_FILTER_KEYS,
  activityParam,
  activityWindow,
  listInputFromSearch,
  recordListSearchSchema,
  valuesParam,
} from "@/client/features/records/listSearch";
import { CONTACT_SORTS, type ContactListInput } from "@/types/schemas/contacts";

/** /contacts: the shared list params, with the contacts' sorts and filters. */
export const contactListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(CONTACT_SORTS).optional().catch(undefined),
  company: valuesParam,
  title: valuesParam,
  seniority: valuesParam,
  persona: valuesParam,
  activity: activityParam,
});

export type ContactListSearch = z.infer<typeof contactListSearchSchema>;

/** The params the contacts list filters by. */
export const CONTACT_FILTER_KEYS = [
  ...SHARED_FILTER_KEYS,
  "company",
  "title",
  "seniority",
  "persona",
  "activity",
] as const;

/** Newest first, as the CRM lists contacts. */
export function contactListInput(search: ContactListSearch): ContactListInput {
  return {
    ...listInputFromSearch(search, { sort: "createdAt", dir: "desc" }),
    company: search.company ?? [],
    title: search.title ?? [],
    seniority: search.seniority ?? [],
    persona: search.persona ?? [],
    activity: activityWindow(search.activity),
  };
}
