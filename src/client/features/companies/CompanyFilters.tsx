import { useQuery } from "@tanstack/react-query";
import { Factory, Sparkles } from "lucide-react";
import { FilterChip } from "@/client/components/table/FilterChip";
import { companyFilterOptionsQueryOptions } from "@/client/features/companies/companyQueries";
import type { CompanyListSearch } from "@/client/features/companies/companySearch";
import { ENRICHMENT_OPTIONS } from "@/client/features/records/EnrichmentStatus";
import {
  ActivityFilter,
  chosen,
  valueOptions,
} from "@/client/features/records/ListFilters";
import { ENRICHMENT_STATUSES } from "@/shared/crm-enums";
import { FACET_FILTER_MAX } from "@/types/schemas/records";

/**
 * The companies list's own filters, after the owner: industry, where the
 * research agent is with them, and how recently anything happened.
 */
export function CompanyFilters({
  search,
  onSearchChange,
}: {
  search: CompanyListSearch;
  onSearchChange: (update: Partial<CompanyListSearch>) => void;
}) {
  const options = useQuery(
    companyFilterOptionsQueryOptions(search.archived ?? false),
  );
  return (
    <>
      <FilterChip
        label="Industry"
        icon={Factory}
        options={valueOptions(options.data?.industries)}
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
        onChange={(activity) => onSearchChange({ activity, page: undefined })}
      />
    </>
  );
}
