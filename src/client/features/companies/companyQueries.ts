import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  companyOptions,
  getCompany,
  listCompanies,
} from "@/serverFunctions/companies";
import type { CompanyListInput } from "@/types/schemas/companies";

// Every company query lives under ["companies"]; a write invalidates them all.
export const companyKeys = {
  all: ["companies"] as const,
  lists: ["companies", "list"] as const,
  list: (input: CompanyListInput) => ["companies", "list", input] as const,
  detail: (id: string) => ["companies", "detail", id] as const,
  options: (q: string) => ["companies", "options", q] as const,
};

export const companyListQueryOptions = (input: CompanyListInput) =>
  queryOptions({
    queryKey: companyKeys.list(input),
    queryFn: () => listCompanies({ data: input }),
    // A new page or filter keeps the rows on screen until it arrives.
    placeholderData: keepPreviousData,
  });

export const companyQueryOptions = (id: string) =>
  queryOptions({
    queryKey: companyKeys.detail(id),
    queryFn: () => getCompany({ data: { id } }),
  });

/** Live companies whose name or domain contains `q`, for pickers. */
export const companyOptionsQueryOptions = (q: string) =>
  queryOptions({
    queryKey: companyKeys.options(q),
    queryFn: () => companyOptions({ data: { q } }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
