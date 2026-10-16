import { sql } from "drizzle-orm";
import { text } from "drizzle-orm/pg-core";

// Timestamps are stored as *text* (same column shape as the SQLite schema).
// Postgres `timestamptz` would be parsed back into a JS Date by postgres-js
// (even with drizzle `mode:"string"`), silently breaking the lexicographic
// string comparisons the app does on timestamps. `isoNow` matches the format of
// `new Date().toISOString()` and the SQLite default (../columns.ts), so
// DB-defaulted and app-written values sort together on both backends.
export const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const timestamp = (name: string) => text(name);
