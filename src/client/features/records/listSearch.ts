import { useState } from "react";
import type {
  OnChangeFn,
  RowSelectionState,
  VisibilityState,
} from "@tanstack/react-table";
import { z } from "zod";
import type { RecordTab } from "@/client/features/records/recordStack";
import { fieldFiltersSchema, type FieldFilters } from "@/types/schemas/fields";
import {
  ACTIVITY_WINDOWS,
  FACET_FILTER_MAX,
  LIST_PAGE_SIZE,
  SORT_DIRECTIONS,
  type ActivityWindow,
  type SortDirection,
} from "@/types/schemas/records";

// A record list's state lives in its URL, so a link (or the back button)
// brings back the same search, filters (custom field ones included), sort,
// hidden columns and page. Each list route validates `recordListSearchSchema`
// extended with its own sort keys and filters:
//
//   validateSearch: recordListSearchSchema.extend({
//     sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
//   })
//
// A saved view is that state without the page and the open sheets
// (`savedViewOf`), parsed back with the same schema when it's applied.

// The router reads `?q=42` (or an id of digits) as a number: keep it text.
const textParam = z
  .union([z.string(), z.number()])
  .transform(String)
  .optional()
  .catch(undefined);

/** A filter's chosen values; one that doesn't parse drops the filter. */
export const valuesParam = z
  .array(z.union([z.string(), z.number()]).transform(String))
  .max(FACET_FILTER_MAX)
  .optional()
  .catch(undefined);

/** The Activity filter's windows, in days. */
export const ACTIVITY_DAYS = [7, 30, 90] as const;

/** The Activity filter: its days, a number in the URL (`?activity=30`). */
export const activityParam = z.coerce
  .number()
  .pipe(z.literal([...ACTIVITY_DAYS]))
  .optional()
  .catch(undefined);

/** The list input's Activity filter, from the URL's. */
export function activityWindow(days: number | undefined) {
  return ACTIVITY_WINDOWS.find((window) => window === String(days));
}

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
 * stale or hand-edited link still opens the list. `hide` is the columns the
 * Columns menu hid; absent, the list's own default ones are hidden.
 */
export const recordListSearchSchema = z.object({
  q: textParam,
  owner: z.array(z.string()).optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
  fields: fieldFiltersParam,
  dir: z.enum(SORT_DIRECTIONS).optional().catch(undefined),
  page: z.coerce.number().int().positive().optional().catch(undefined),
  hide: z.array(z.string()).optional().catch(undefined),
});

export type RecordListSearch = z.infer<typeof recordListSearchSchema>;

/** The list's server input, from its URL and the entity's default sort. */
export function listInputFromSearch<TSort extends string>(
  search: RecordListSearch & { sort?: TSort },
  defaults: { sort: TSort; dir: SortDirection },
) {
  const archived = search.archived ?? false;
  // The Archived column, and its sort, are the Archived view's alone.
  const sort =
    search.sort === "archivedAt" && !archived ? undefined : search.sort;
  return {
    q: search.q?.trim() ?? "",
    owner: search.owner ?? [],
    archived,
    fields: search.fields ?? {},
    sort: sort ?? defaults.sort,
    dir: search.dir ?? (sort ? "asc" : defaults.dir),
    page: search.page ?? 1,
    pageSize: LIST_PAGE_SIZE,
  };
}

/** The Activity filter's choices, as the CRM words them. */
export const ACTIVITY_OPTIONS: { value: ActivityWindow; label: string }[] = [
  { value: "7", label: "Active within 7 days" },
  { value: "30", label: "Active within 30 days" },
  { value: "90", label: "Active within 90 days" },
];

/** The URL params every list filters by, besides its own. */
export const SHARED_FILTER_KEYS = ["q", "owner", "fields"] as const;

/** Whether any of `keys` (a list's filter params) narrows the list. */
export function isListFiltered(
  search: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => {
    const value = search[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim() !== "";
    if (value && typeof value === "object")
      return Object.keys(value).length > 0;
    return value !== undefined;
  });
}

/** The URL update that clears every filter in `keys`, on the first page. */
export function clearedFilters<TKey extends string>(
  keys: readonly TKey[],
): Partial<Record<TKey | "page", undefined>> {
  const cleared: Partial<Record<TKey | "page", undefined>> = {};
  for (const key of [...keys, "page" as const]) cleared[key] = undefined;
  return cleared;
}

/** The sheets open over the list (RecordSheetHost's params). */
type SheetSearch = { record?: string; tab?: RecordTab };

/**
 * What a saved view keeps of a list's URL: its search, filters, sort and
 * columns, not the page or the sheets open over it.
 */
export function savedViewOf<TSearch extends RecordListSearch>(
  search: TSearch & SheetSearch,
): Omit<TSearch, "page" | "record" | "tab"> {
  const { page: _page, record: _record, tab: _tab, ...view } = search;
  return view;
}

/**
 * A saved view applied: the list's URL becomes what of the view still
 * parses with the list's own schema (a view outlives the shape it was saved
 * in), on the first page, the sheets open over the list left open.
 */
export function searchFromSavedView<TSearch extends RecordListSearch>(
  schema: { parse: (filters: unknown) => TSearch },
  filters: Record<string, unknown>,
  current: SheetSearch,
): TSearch & SheetSearch {
  return {
    ...schema.parse(filters),
    page: undefined,
    record: current.record,
    tab: current.tab,
  };
}

/**
 * The table's column visibility from the URL's `hide` (the list's default
 * hidden columns when it has none), and a change to it written back: no
 * `hide` once it's the default again.
 */
export function columnVisibility(
  hide: string[] | undefined,
  defaults: readonly string[],
  onHide: (hide: string[] | undefined) => void,
) {
  const hidden = hide ?? defaults;
  const state: VisibilityState = Object.fromEntries(
    hidden.map((id) => [id, false]),
  );
  const onChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = typeof updater === "function" ? updater(state) : updater;
    const nextHidden = Object.keys(next).filter((id) => !next[id]);
    const isDefault =
      nextHidden.length === defaults.length &&
      defaults.every((id) => nextHidden.includes(id));
    onHide(isDefault ? undefined : nextHidden);
  };
  return { state, onChange };
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
