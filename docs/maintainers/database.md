# The database

The CRM's data lives in D1 (SQLite) ([every-app.md](every-app.md#database)). This note is about keeping it fast and its data safe.

## Changing the schema

Change tables additively: new tables, new nullable or defaulted columns, new indexes. Two things make anything else dangerous.

- **A rebuild deletes data on D1.** To change a column's type, nullability or default, drizzle rebuilds the SQLite table: it copies it into `__new_<table>`, drops the original and renames the copy. D1 ignores `PRAGMA foreign_keys=OFF` in a migration, so the `DROP TABLE` fires every `ON DELETE cascade` into the table, and changing one column on `company` deletes deals and activities.
- **Deploys migrate before they upload.** The Worker that is serving runs on the migrated schema until the upload replaces it, and stays on it if the upload fails, so a migration may only add. A column or table that goes away is dropped a release after the last code that read it, in a migration marked `-- everyapp:contract <release it follows>`, as the gateway's migrations are.

To change a column, add a new one, write both, backfill, move the reads, and drop the old one a release later. `src/db/release-migrations.test.ts` refuses an unmarked drop or rename, and any rebuild, marked or not.

## Indexes

Most indexes lead with `organization_id`, since every list is one organization's. A foreign key that deleting a record follows (deleting the rows, or setting the key to null) also has one led by the key, because the database looks those rows up by the key alone.

## Statistics on D1

SQLite plans without statistics until `ANALYZE` runs, which D1 leaves to the app. Without them the planner can pick the wrong index: the company list's per-row counts once scanned every contact for each company. The daily cron runs `PRAGMA optimize` at 05:00 UTC (`src/db/maintenance.ts`). It analyzes each table with an index that has no statistics yet, so a deploy's new indexes get theirs within a day, and each table queried since D1 opened the database that has grown or shrunk tenfold.

To see them: `pnpm everyapp db query "select tbl, idx, stat from sqlite_stat1"` (`--local` for `pnpm dev`'s database).

## Size

D1 refuses every write once a database reaches 10 GB, with no warning. `/health/dispatch` reports the database and its size, `"database": { "provider": "d1", "sizeBytes": … }`, so watch it.
