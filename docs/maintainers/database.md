# The database

One schema in two dialects, D1 (SQLite) for forks and Postgres through Hyperdrive for the first party ([every-app.md](every-app.md#database)). This note is about keeping both fast and their data safe.

## Changing the schema

Change tables additively: new tables, new nullable or defaulted columns, new indexes. Two things make anything else dangerous.

- **A rebuild deletes data on D1.** To change a column's type, nullability or default, drizzle rebuilds the SQLite table: it copies it into `__new_<table>`, drops the original and renames the copy. D1 ignores `PRAGMA foreign_keys=OFF` in a migration, so the `DROP TABLE` fires every `ON DELETE cascade` into the table, and changing one column on `company` deletes deals and activities.
- **Deploys migrate before they upload.** The Worker that is serving runs on the migrated schema until the upload replaces it, and stays on it if the upload fails, so a migration may only add. A column or table that goes away is dropped a release after the last code that read it, in a migration marked `-- everyapp:contract <release it follows>`, as the gateway's migrations are.

To change a column, add a new one, write both, backfill, move the reads, and drop the old one a release later. `src/db/release-migrations.test.ts` refuses an unmarked drop or rename in either dialect, and any D1 rebuild, marked or not.

On Postgres an index builds under a lock that holds writes to its table. For a large live table, build it by hand first with `CREATE INDEX CONCURRENTLY`, and make the migration's statement `CREATE INDEX IF NOT EXISTS`.

## Indexes

Both dialects have the same indexes, and `src/db/schema-parity.test.ts` compares them. Most lead with `organization_id`, since every list is one organization's. A foreign key that deleting a record follows (deleting the rows, or setting the key to null) also has one led by the key, because Postgres looks those rows up by the key alone, across every organization.

## Statistics on D1

SQLite plans without statistics until `ANALYZE` runs, which D1 leaves to the app. Without them the planner can pick the wrong index: the company list's per-row counts once scanned every contact for each company. The daily cron runs `PRAGMA optimize` at 05:00 UTC (`src/db/maintenance.ts`). It analyzes each table with an index that has no statistics yet, so a deploy's new indexes get theirs within a day, and each table queried since D1 opened the database that has grown or shrunk tenfold. Postgres keeps its own statistics.

To see them: `pnpm everyapp db query "select tbl, idx, stat from sqlite_stat1"` (`--local` for `pnpm dev`'s database).

## Size

D1 refuses every write once a database reaches 10 GB, with no warning. On a fork, `/health/dispatch` reports the database and its size, `"database": { "provider": "d1", "sizeBytes": … }`; a fork nearing the limit moves to Postgres. A first-party deployment's database is every organization's, so its health check leaves the size out.

## Placement

With Postgres, a request's queries cross to the database one after another, so the Worker should run beside it. `everyapp.config.ts` sets `database.region`, which the deploy turns into Cloudflare's targeted placement. It is `aws:us-east-1`, beside OpenSEO's database, unless `OPEN_CRM_DATABASE_REGION` names another region at deploy (`gcp:europe-west1`, `azure:westeurope`, …). Cloudflare places only the fetch handler this way: the cron and the agent's Durable Objects run where it puts them.

A shared deploy serves every organization, so it must run on Postgres. Built on D1 it would move them all onto an empty database, and `cloudflare.config.ts` fails the build before the deploy migrates or uploads anything.

## Moving a fork from D1 to Postgres

1. **Provision Postgres** where Hyperdrive can reach it, and note its region.
2. **Create the schema:** `POSTGRES_DATABASE_URL=postgres://… pnpm db:migrate:pg`.
3. **Copy the data.** The CRM has no script for this yet. OpenSEO's `scripts/migrate-d1-to-postgres.ts` is the model: it reads each D1 table over the Cloudflare API, runs each value through the SQLite column's codec and writes it through the Postgres schema, in foreign-key order, then compares row counts. For the CRM, the codecs cover the auth mirror tables' epoch-millisecond timestamps, 0/1 booleans and JSON stored as text; the other timestamps are ISO text on both already. `company.primary_contact_id` and `contact.company_id` reference each other, so companies go in without their primary contact, which is set once contacts are in. No column is serial. Writes made to D1 during the copy are lost unless a second pass catches them up (OpenSEO's `--update`), so copy at a quiet time.
4. **Deploy on Postgres:** put the URL in `.everyapp/secrets.env` as `POSTGRES_DATABASE_URL`, then run `OPEN_CRM_DATABASE=postgres OPEN_CRM_DATABASE_REGION=<region> pnpm deploy:everyapp`. The deploy creates the Hyperdrive config and uploads the Worker bound to it instead of D1.
5. **Deploy that way from then on.** A deploy without `OPEN_CRM_DATABASE=postgres` binds the Worker to the D1 database again, as it was at the move. That is also the rollback, and it loses what was written to Postgres since.

Images in R2 and the agent's conversations in Durable Objects stay where they are: they are keyed by organization and session, not stored in the database.
