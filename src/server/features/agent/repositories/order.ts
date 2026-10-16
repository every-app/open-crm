import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

// NULL ordering differs by dialect (Postgres sorts NULLs first in DESC, SQLite
// last), so orderings over nullable columns say where NULLs go. Both D1's
// SQLite and Postgres accept NULLS FIRST / NULLS LAST.

export function descNullsLast(column: SQLiteColumn): SQL {
  return sql`${column} desc nulls last`;
}

export function ascNullsFirst(column: SQLiteColumn): SQL {
  return sql`${column} asc nulls first`;
}
