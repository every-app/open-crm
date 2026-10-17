import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { enrichmentRefetchInterval } from "@/client/features/records/EnrichmentStatus";
import {
  contactFilterOptions,
  getContact,
  listContacts,
} from "@/serverFunctions/contacts";
import type { ContactListInput } from "@/types/schemas/contacts";

// Every contact query lives under ["contacts"]; a write invalidates them all.
export const contactKeys = {
  all: ["contacts"] as const,
  lists: ["contacts", "list"] as const,
  list: (input: ContactListInput) => ["contacts", "list", input] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
  filterOptions: (archived: boolean) =>
    ["contacts", "filterOptions", archived] as const,
};

export const contactListQueryOptions = (input: ContactListInput) =>
  queryOptions({
    queryKey: contactKeys.list(input),
    queryFn: () => listContacts({ data: input }),
    // A new page or filter keeps the rows on screen until it arrives.
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      enrichmentRefetchInterval(query.state.data?.rows ?? []),
  });

export const contactQueryOptions = (id: string) =>
  queryOptions({
    queryKey: contactKeys.detail(id),
    queryFn: () => getContact({ data: { id } }),
    refetchInterval: (query) =>
      enrichmentRefetchInterval(query.state.data ? [query.state.data] : []),
  });

/**
 * What the list's Title, Seniority and Persona filters offer, in its live or
 * Archived view.
 */
export const contactFilterOptionsQueryOptions = (archived: boolean) =>
  queryOptions({
    queryKey: contactKeys.filterOptions(archived),
    queryFn: () => contactFilterOptions({ data: { archived } }),
    staleTime: 60_000,
  });
