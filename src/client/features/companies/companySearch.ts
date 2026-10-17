import { z } from "zod";
import {
  SHARED_FILTER_KEYS,
  activityParam,
  activityWindow,
  listInputFromSearch,
  recordListSearchSchema,
  valuesParam,
} from "@/client/features/records/listSearch";
import { ENRICHMENT_STATUSES } from "@/shared/crm-enums";
import {
  COMPANY_SORTS,
  type CompanyListInput,
} from "@/types/schemas/companies";

/** /companies: the shared list params, with the companies' sorts and filters. */
export const companyListSearchSchema = recordListSearchSchema.extend({
  sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
  industry: valuesParam,
  enrichment: z.array(z.enum(ENRICHMENT_STATUSES)).optional().catch(undefined),
  activity: activityParam,
});

export type CompanyListSearch = z.infer<typeof companyListSearchSchema>;

/** The params the companies list filters by. */
export const COMPANY_FILTER_KEYS = [
  ...SHARED_FILTER_KEYS,
  "industry",
  "enrichment",
  "activity",
] as const;

/** Newest first, as the CRM lists companies. */
export function companyListInput(search: CompanyListSearch): CompanyListInput {
  return {
    ...listInputFromSearch(search, { sort: "createdAt", dir: "desc" }),
    industry: search.industry ?? [],
    enrichment: search.enrichment ?? [],
    activity: activityWindow(search.activity),
  };
}
