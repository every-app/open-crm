import { queryOptions } from "@tanstack/react-query";
import { getEnrichmentSettings } from "@/serverFunctions/enrichment";

/** The enrichment providers' state, and the one each kind of record uses. */
export const enrichmentSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "enrichment"],
    queryFn: () => getEnrichmentSettings(),
  });
