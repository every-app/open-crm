import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  dealContactOptions,
  getDeal,
  listDeals,
} from "@/serverFunctions/deals";
import type { DealListInput } from "@/types/schemas/deals";

// Every deal query lives under ["deals"]; a write invalidates them all.
export const dealKeys = {
  all: ["deals"] as const,
  lists: ["deals", "list"] as const,
  list: (input: DealListInput) => ["deals", "list", input] as const,
  detail: (id: string) => ["deals", "detail", id] as const,
  contactOptions: (dealId: string) =>
    ["deals", "contact-options", dealId] as const,
};

export const dealListQueryOptions = (input: DealListInput) =>
  queryOptions({
    queryKey: dealKeys.list(input),
    queryFn: () => listDeals({ data: input }),
    // A new page or filter keeps the rows on screen until it arrives.
    placeholderData: keepPreviousData,
  });

export const dealQueryOptions = (id: string) =>
  queryOptions({
    queryKey: dealKeys.detail(id),
    queryFn: () => getDeal({ data: { id } }),
  });

/** Who at the deal's company isn't on it yet. */
export const dealContactOptionsQueryOptions = (dealId: string) =>
  queryOptions({
    queryKey: dealKeys.contactOptions(dealId),
    queryFn: () => dealContactOptions({ data: { dealId } }),
  });
