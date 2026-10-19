import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { activityKeys } from "@/client/features/activities/activityQueries";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { dashboardKeys } from "@/client/features/dashboard/dashboardQueries";
import { dealKeys } from "@/client/features/deals/dealQueries";
import { searchKeys } from "@/client/features/search/searchQueries";

// Companies, contacts and deals show on each other's lists and sheets (a
// contact's company, a company's people and pipeline, a deal's contacts), in
// ⌘K, on the timelines and on the Overview, so a write to any one of them
// refetches all of those, as the CRM's cache does.
const RECORD_QUERIES = [
  companyKeys.all,
  contactKeys.all,
  dealKeys.all,
  activityKeys.all,
  dashboardKeys.all,
  searchKeys.all,
];

type Settle = {
  /**
   * A sheet's own record: the refetch resolves once it has read back (the
   * edited value shows until then), and the rest refetch behind it.
   */
  record?: QueryKey;
  /**
   * A record deleted forever: its sheet is still closing, so its query is
   * left to expire rather than read a 404.
   */
  gone?: QueryKey;
};

/** Refetches everything a company, contact or deal write can change. */
export function useInvalidateRecords() {
  const queryClient = useQueryClient();
  return ({ record, gone }: Settle = {}): Promise<unknown> => {
    const skipped = new Set(
      [record, gone].flatMap((key) => (key ? [hashKey(key)] : [])),
    );
    const rest = Promise.all(
      RECORD_QUERIES.map((queryKey) =>
        queryClient.invalidateQueries({
          queryKey,
          predicate: (query) => !skipped.has(query.queryHash),
        }),
      ),
    );
    if (!record) return rest;
    void rest;
    return queryClient.invalidateQueries({ queryKey: record });
  };
}
