import {
  asc,
  count,
  desc,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { user } from "@/db/schema";
import {
  ACTIVITY_WINDOWS,
  UNASSIGNED,
  type ActivityWindow,
  type ListInput,
  type SortDirection,
} from "@/types/schemas/records";

// The parts every record list's query shares: the page window, the search,
// the owner, archived and activity filters, the order, and the counts of its
// filters' values. Each repository combines them with its organization
// filter and its own columns.
//
// A list's scope is the organization's live (or archived) records its search
// finds. Its filters narrow the scope to its rows; their counts (the original
// CRM's facet counts) are over the whole scope, so each filter offers the
// values the scope holds, however the other filters are set.

/** The most values a free-text filter counts: its column's commonest. */
export const FILTER_OPTIONS_MAX = 200;

/**
 * A record's owner as a list row shows them, from `user` left-joined on the
 * record's owner: null for nobody.
 */
export const ownerColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
};

/**
 * GROUP BY rows as one filter's counts, by value. Rows with no value count
 * under `nullKey` (the filter's value for none), or not at all.
 */
export function countsByValue(
  rows: { value: string | null; count: number }[],
  nullKey?: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.value ?? nullKey;
    if (key !== undefined) counts[key] = (counts[key] ?? 0) + row.count;
  }
  return counts;
}

/** How many rows `condition` holds for, as a column of an aggregate select. */
export function countWhere(condition: SQL | undefined) {
  return condition
    ? sql<number>`count(case when ${condition} then 1 end)`.mapWith(Number)
    : count();
}

/** The Activity filter's counts: rows with activity in each window. */
export function activityCounts(column: AnyColumn) {
  return Object.fromEntries(
    ACTIVITY_WINDOWS.map((window) => [
      window,
      countWhere(activityCondition(column, window)),
    ]),
  );
}

/** LIMIT and OFFSET for the requested page. */
export function pageWindow(input: Pick<ListInput, "page" | "pageSize">) {
  return { limit: input.pageSize, offset: (input.page - 1) * input.pageSize };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * A case-insensitive "contains" over any of `columns` (or expressions).
 * Both sides are lowered in SQL: `lower()` is ASCII only on SQLite, so there
 * accented capitals match only themselves, which lowering the term in
 * JavaScript would break.
 */
export function searchCondition(
  q: string,
  columns: SQLWrapper[],
): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;
  const pattern = `%${escapeLike(term)}%`;
  return or(
    ...columns.map(
      (column) => sql`lower(${column}) like lower(${pattern}) escape '\\'`,
    ),
  );
}

/** The owner filter: the chosen owners, and `UNASSIGNED` for nobody's. */
export function ownerCondition(
  column: AnyColumn,
  owners: string[],
): SQL | undefined {
  if (owners.length === 0) return undefined;
  const ids = owners.filter((owner) => owner !== UNASSIGNED);
  return or(
    ids.length > 0 ? inArray(column, ids) : undefined,
    ids.length < owners.length ? isNull(column) : undefined,
  );
}

/** Live records, or only archived ones for the Archived view. */
export function archivedCondition(column: AnyColumn, archived: boolean): SQL {
  return archived ? isNotNull(column) : isNull(column);
}

/** Rows whose `column` is any of `values`; no filter when there are none. */
export function anyOfCondition(
  column: AnyColumn,
  values: readonly string[],
): SQL | undefined {
  return values.length > 0 ? inArray(column, values) : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Records something happened on in the window's last days. */
export function activityCondition(
  column: AnyColumn,
  window: ActivityWindow | undefined,
): SQL | undefined {
  if (!window) return undefined;
  return gte(
    column,
    new Date(Date.now() - Number(window) * DAY_MS).toISOString(),
  );
}

/**
 * What a sort key orders by. `nullsLast` keeps blanks at the bottom; `ties`
 * orders rows that tie on it, whichever way it sorts.
 */
export type SortSpec = { by: SQLWrapper; nullsLast?: boolean; ties?: SQL[] };

/**
 * ORDER BY for a sort. A nullable column says where its blanks go itself; the id breaks ties so
 * pages never overlap.
 */
export function sortOrder(
  spec: SortSpec,
  dir: SortDirection,
  tiebreak: AnyColumn,
): SQL[] {
  const direction = dir === "asc" ? asc : desc;
  return [
    // false sorts before true on both: rows with a value come first.
    ...(spec.nullsLast ? [sql`(${spec.by} is null)`] : []),
    direction(spec.by),
    ...(spec.ties ?? []),
    asc(tiebreak),
  ];
}
