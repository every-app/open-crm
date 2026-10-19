import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `everyapp deploy` migrates the database before it uploads the new code, so
 * the Worker that is serving runs on the migrated schema until the upload
 * replaces it, and stays on it if the upload fails: a migration may add,
 * never take away. A migration that drops or renames a table or column waits
 * a release, until no live code reads it, and says so with
 * `-- everyapp:contract <release it follows>`, as the gateway's do.
 *
 * On D1 a table rebuild (drizzle's `__new_<table>` copy, then DROP TABLE) is
 * never safe, marked or not: D1 ignores `PRAGMA foreign_keys=OFF` in a
 * migration, so the DROP fires every `ON DELETE cascade` into the table and
 * deletes rows in other tables. Change tables additively instead
 * (docs/maintainers/database.md).
 */
const DIR = "drizzle/sqlite";
const CONTRACTING = /\bDROP\s+(TABLE|COLUMN)\b|\bRENAME\b/i;
const MARKED = /^--\s*everyapp:contract\s+\S+/m;
const REBUILDING = /\bDROP\s+TABLE\b|__new_/i;

const MIGRATIONS = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => `${DIR}/${file}`);

function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migrations", () => {
  it.each(MIGRATIONS)("%s only expands the schema", (path) => {
    const sql = readFileSync(path, "utf8");
    if (MARKED.test(sql)) return;
    expect(
      withoutComments(sql).match(CONTRACTING)?.[0] ?? null,
      `${path} drops or renames: mark it "-- everyapp:contract <release>" once no live code uses what it removes`,
    ).toBeNull();
  });

  it.each(MIGRATIONS)("%s rebuilds no table", (path) => {
    expect(
      withoutComments(readFileSync(path, "utf8")).match(REBUILDING)?.[0] ??
        null,
      `${path} rebuilds a table, which on D1 deletes the rows other tables cascade from it: change the table additively`,
    ).toBeNull();
  });
});
