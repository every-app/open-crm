import { z } from "zod";
import {
  listInputFromSearch,
  recordListSearchSchema,
} from "@/client/features/records/listSearch";
import {
  COMPANY_SORTS,
  type CompanyListInput,
} from "@/types/schemas/companies";

/** /companies: the shared list params, with the companies' sort keys. */
export const companyListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
});

export type CompanyListSearch = z.infer<typeof companyListSearchSchema>;

/** Newest first, as the CRM lists companies. */
export function companyListInput(search: CompanyListSearch): CompanyListInput {
  return listInputFromSearch(search, { sort: "createdAt", dir: "desc" });
}
