import { z } from "zod";
import {
  listInputFromSearch,
  recordListSearchSchema,
} from "@/client/features/records/listSearch";
import { CONTACT_SORTS, type ContactListInput } from "@/types/schemas/contacts";

/** /contacts: the shared list params, with the contacts' sort keys. */
export const contactListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(CONTACT_SORTS).optional().catch(undefined),
});

export type ContactListSearch = z.infer<typeof contactListSearchSchema>;

/** Newest first, as the CRM lists contacts. */
export function contactListInput(search: ContactListSearch): ContactListInput {
  return listInputFromSearch(search, { sort: "createdAt", dir: "desc" });
}
