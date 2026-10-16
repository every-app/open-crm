import { sql } from "drizzle-orm";
import { text } from "drizzle-orm/sqlite-core";

// Timestamps are stored as text, as in OpenSEO, so both dialects compare them
// the same way. Unlike OpenSEO's `current_timestamp` default, the default
// here is ISO 8601 UTC with milliseconds: exactly what
// `new Date().toISOString()` writes and what the Postgres default
// (./pg/columns.ts) produces, so database-defaulted and app-written values
// sort together on both backends. The CRM compares them constantly (due
// tasks, leases, last activity).
export const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const timestamp = (name: string) => text(name);
