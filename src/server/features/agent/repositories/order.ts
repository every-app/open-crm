import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

// Orderings over nullable columns say where NULLs go (NULLS FIRST / NULLS
// LAST), rather than leave it to the database's default.

export function descNullsLast(column: SQLiteColumn): SQL {
  return sql`${column} desc nulls last`;
}

export function ascNullsFirst(column: SQLiteColumn): SQL {
  return sql`${column} asc nulls first`;
}
