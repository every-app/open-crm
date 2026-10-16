import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { quickSearch } from "@/serverFunctions/search";

/** Live companies, contacts and deals matching `q`, a few of each. */
export const quickSearchQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ["search", q],
    queryFn: () => quickSearch({ data: { q } }),
    // The previous matches stay while the next ones load.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
