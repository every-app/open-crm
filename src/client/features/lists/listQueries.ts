import { queryOptions } from "@tanstack/react-query";
import {
  getRecordLists,
  listEntries,
  listLists,
} from "@/serverFunctions/lists";
import type { ListEntity } from "@/shared/crm-enums";
import type { ListEntriesInput } from "@/types/schemas/lists";

export const listKeys = {
  all: ["lists"] as const,
  summaries: () => [...listKeys.all, "summaries"] as const,
  entries: (input: ListEntriesInput) =>
    [...listKeys.all, "entries", input] as const,
  record: (entity: ListEntity, id: string) =>
    [...listKeys.all, "record", entity, id] as const,
};

/** The organization's live lists, with counts by stage and Due: the sidebar's. */
export const listsQueryOptions = () =>
  queryOptions({
    queryKey: listKeys.summaries(),
    queryFn: () => listLists({ data: { includeArchived: false } }),
  });

/** A list's board: its entries with their cards. */
export const listEntriesQueryOptions = (input: ListEntriesInput) =>
  queryOptions({
    queryKey: listKeys.entries(input),
    queryFn: () => listEntries({ data: input }),
  });

/** The lists a contact or company is in, with its stage in each. */
export const recordListsQueryOptions = (entity: ListEntity, id: string) =>
  queryOptions({
    queryKey: listKeys.record(entity, id),
    queryFn: () => getRecordLists({ data: { entity, id } }),
  });
