import { Factory, Sparkles } from "lucide-react";
import { FilterChip, countsFor } from "@/client/components/table/FilterChip";
import type { CompanyListSearch } from "@/client/features/companies/companySearch";
import { ENRICHMENT_OPTIONS } from "@/client/features/records/EnrichmentStatus";
import {
  ActivityFilter,
  chosen,
  valueOptions,
} from "@/client/features/records/ListFilters";
import { ENRICHMENT_STATUSES } from "@/shared/crm-enums";
import { FACET_FILTER_MAX, type FacetCounts } from "@/types/schemas/records";

/**
 * The companies list's own filters, after the owner: industry, where the
 * research agent is with them, and how recently anything happened.
 */
export function CompanyFilters({
  search,
  onSearchChange,
  facetCounts,
}: {
  search: CompanyListSearch;
  onSearchChange: (update: Partial<CompanyListSearch>) => void;
  facetCounts: FacetCounts | undefined;
}) {
  const industries = countsFor(facetCounts, "industry");
  return (
    <>
      <FilterChip
        label="Industry"
        icon={Factory}
        options={valueOptions(industries)}
        counts={industries}
        value={search.industry ?? []}
        max={FACET_FILTER_MAX}
        onChange={(industry) =>
          onSearchChange({ industry: chosen(industry), page: undefined })
        }
      />
      <FilterChip
        label="Enrichment"
        icon={Sparkles}
        options={ENRICHMENT_OPTIONS}
        counts={countsFor(facetCounts, "enrichment")}
        value={search.enrichment ?? []}
        onChange={(values) =>
          onSearchChange({
            enrichment: chosen(
              ENRICHMENT_STATUSES.filter((status) => values.includes(status)),
            ),
            page: undefined,
          })
        }
      />
      <ActivityFilter
        value={search.activity}
        counts={countsFor(facetCounts, "activity")}
        onChange={(activity) => onSearchChange({ activity, page: undefined })}
      />
    </>
  );
}
