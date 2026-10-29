import { Factory } from "lucide-react";
import {
  countsFor,
  type ListFilter,
} from "@/client/components/table/FiltersMenu";
import type { CompanyListSearch } from "@/client/features/companies/companySearch";
import {
  activityFilter,
  chosen,
  valueOptions,
} from "@/client/features/records/ListFilters";
import { FACET_FILTER_MAX, type FacetCounts } from "@/types/schemas/records";

/**
 * The companies list's own filters, after the owner: industry and how
 * recently anything happened.
 */
export function companyFilters(
  search: CompanyListSearch,
  onSearchChange: (update: Partial<CompanyListSearch>) => void,
  facetCounts: FacetCounts | undefined,
): ListFilter[] {
  const industries = countsFor(facetCounts, "industry");
  return [
    {
      key: "industry",
      label: "Industry",
      icon: Factory,
      options: valueOptions(industries),
      counts: industries,
      value: search.industry ?? [],
      max: FACET_FILTER_MAX,
      onChange: (industry) =>
        onSearchChange({ industry: chosen(industry), page: undefined }),
    },
    activityFilter({
      value: search.activity,
      counts: countsFor(facetCounts, "activity"),
      onChange: (activity) => onSearchChange({ activity, page: undefined }),
    }),
  ];
}
