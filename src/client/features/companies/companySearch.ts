import { z } from "zod";
import {
  SHARED_FILTER_KEYS,
  activityParam,
  LIST_MEMBERSHIP_FILTER_KEYS,
  activityWindow,
  listInputFromSearch,
  listMembershipInput,
  listMembershipParams,
  recordListSearchSchema,
  valuesParam,
} from "@/client/features/records/listSearch";
import {
  COMPANY_SORTS,
  type CompanyListInput,
} from "@/types/schemas/companies";

/** /companies: the shared list params, with the companies' sorts and filters. */
export const companyListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
  industry: valuesParam,
  activity: activityParam,
  ...listMembershipParams,
});

export type CompanyListSearch = z.infer<typeof companyListSearchSchema>;

/** The params the companies list filters by. */
export const COMPANY_FILTER_KEYS = [
  ...SHARED_FILTER_KEYS,
  "industry",
  "activity",
  ...LIST_MEMBERSHIP_FILTER_KEYS,
] as const;

/** Newest first, as the CRM lists companies. */
export function companyListInput(search: CompanyListSearch): CompanyListInput {
  return {
    ...listInputFromSearch(search, { sort: "createdAt", dir: "desc" }),
    industry: search.industry ?? [],
    activity: activityWindow(search.activity),
    ...listMembershipInput(search),
  };
}
