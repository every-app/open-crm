import { useState } from "react";
import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";
import { z } from "zod";
import { fieldFiltersSchema, type FieldFilters } from "@/types/schemas/fields";
import {
  LIST_PAGE_SIZE,
  SORT_DIRECTIONS,
  type SortDirection,
} from "@/types/schemas/records";

// A record list's state lives in its URL, so a link (or the back button)
// brings back the same search, filters (custom field ones included), sort,
// page and open record. Each list route validates `recordListSearchSchema`
// extended with its own sort keys:
//
//   validateSearch: recordListSearchSchema.extend({
//     sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
//   })

export const RECORD_TABS = ["overview", "activity", "agent"] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

// The router reads `?q=42` (or an id of digits) as a number: keep it text.
const textParam = z
  .union([z.string(), z.number()])
  .transform(String)
  .optional()
  .catch(undefined);

/**
 * Custom field filters by field key, each checked on its own against the
 * list input's schema: one that no longer parses (a hand-edited link, a view
 * saved in an older shape) is dropped and the rest still apply. Filters on
 * fields that were archived or deleted parse; the server ignores them.
 */
const fieldFiltersParam = z
  .record(z.string(), z.unknown())
  .transform((raw): FieldFilters | undefined => {
    const filters = Object.entries(raw).flatMap(([key, value]) => {
      const parsed = fieldFiltersSchema.safeParse({ [key]: value });
      return parsed.success ? Object.entries(parsed.data) : [];
    });
    return filters.length > 0 ? Object.fromEntries(filters) : undefined;
  })
  .optional()
  .catch(undefined);

/**
 * Every param is optional and a value that doesn't parse is dropped, so a
 * stale or hand-edited link still opens the list. `record` is the id of the
 * record whose sheet is open over the list, and `tab` the sheet's tab.
 */
export const recordListSearchSchema = z.object({
  q: textParam,
  owner: z.array(z.string()).optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
  fields: fieldFiltersParam,
  dir: z.enum(SORT_DIRECTIONS).optional().catch(undefined),
  page: z.coerce.number().int().positive().optional().catch(undefined),
  record: textParam,
  tab: z.enum(RECORD_TABS).optional().catch(undefined),
});

export type RecordListSearch = z.infer<typeof recordListSearchSchema>;

/** The list's server input, from its URL and the entity's default sort. */
export function listInputFromSearch<TSort extends string>(
  search: RecordListSearch & { sort?: TSort },
  defaults: { sort: TSort; dir: SortDirection },
) {
  return {
    q: search.q?.trim() ?? "",
    owner: search.owner ?? [],
    archived: search.archived ?? false,
    fields: search.fields ?? {},
    sort: search.sort ?? defaults.sort,
    dir: search.dir ?? (search.sort ? "asc" : defaults.dir),
    page: search.page ?? 1,
    pageSize: LIST_PAGE_SIZE,
  };
}

/** Whether the search or a filter narrows the list (not the view or sort). */
export function isListFiltered(search: RecordListSearch): boolean {
  return (
    Boolean(search.q?.trim()) ||
    (search.owner?.length ?? 0) > 0 ||
    Object.keys(search.fields ?? {}).length > 0
  );
}

/**
 * The table's row selection, emptied whenever `listKey` (the list's input)
 * changes: a selection never outlives the page, filter or view it was made in.
 */
export function useListSelection(listKey: string) {
  const [selection, setSelection] = useState<{
    key: string;
    rows: RowSelectionState;
  }>({ key: listKey, rows: {} });
  const rowSelection = selection.key === listKey ? selection.rows : {};
  const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) =>
    setSelection((current) => {
      const rows = current.key === listKey ? current.rows : {};
      return {
        key: listKey,
        rows: typeof updater === "function" ? updater(rows) : updater,
      };
    });
  return {
    rowSelection,
    onRowSelectionChange,
    selectedIds: Object.keys(rowSelection).filter((id) => rowSelection[id]),
    clear: () => setSelection({ key: listKey, rows: {} }),
  };
}
