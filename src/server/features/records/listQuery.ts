import {
  asc,
  desc,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import {
  UNASSIGNED,
  type ListInput,
  type SortDirection,
} from "@/types/schemas/records";

// The parts every record list's query shares: the page window, the search,
// the owner and archived filters, and the order. Each repository combines
// them with its organization filter and its own columns.

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

/** What a sort key orders by. `nullsLast` keeps blanks at the bottom. */
export type SortSpec = { by: SQLWrapper; nullsLast?: boolean };

/**
 * ORDER BY for a sort. The dialects disagree on where NULL sorts, so a
 * nullable column says where its blanks go itself; the id breaks ties so
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
    asc(tiebreak),
  ];
}
