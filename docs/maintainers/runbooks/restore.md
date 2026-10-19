# Restoring the hosted CRM

The first-party CRM keeps every organization's records in one Postgres database, reached through Hyperdrive. Agent chats and the research agent's transcripts live in `CrmAgent` Durable Objects, and logos, photos and builder chat attachments in one R2 bucket. A fork restores its D1 database with Time Travel instead ([self-hosting.md](../../self-hosting.md#restoring)).

## What can be restored

- Postgres, only from the provider's own backups: the deploy takes a restore point before it migrates D1, but none for Postgres. Point-in-time recovery hasn't been confirmed for the hosted database. Confirm that it's on, and its window, before launch; until then the newest backup is the only way back.
- Nothing restores the Durable Objects or R2. They aren't backed up, and a database restore doesn't rewind them.

Before deploying a release whose migration drops or rewrites data, take a backup in the provider.

## Restoring the database

A restore rewinds every organization, so everything any of them wrote after the restore point is lost. Credits spent since stay spent in Autumn.

1. Stop the damage. If a release caused it, roll the CRM's Worker back in the Cloudflare dashboard (Workers & Pages → the CRM's Worker → Deployments → Rollback). Hold the unattended work every organization's agent would do: `pnpm everyapp secret set FIRST_PARTY_SCHEDULED_RESEARCH`, with the value `off`. Work a person asks for still runs.
2. Restore into a new database, at the last good moment, so production stays as it was until the copy checks out.
3. Check the copy with the operator scripts ([operations.md](operations.md)):

   ```bash
   POSTGRES_DATABASE_URL=<the copy's URL> pnpm ops dispatch --postgres
   POSTGRES_DATABASE_URL=<the copy's URL> pnpm ops organization <an affected organization> --postgres
   ```

4. Point the CRM at the copy: put its URL in `.everyapp/secrets.env` as `POSTGRES_DATABASE_URL`, then run `pnpm deploy:everyapp:first-party`. The deploy points the Hyperdrive config at it ("Pointed … at the database in .everyapp/secrets.env"), applies any migrations the copy lacks, and uploads.
5. Start unattended work again: set `FIRST_PARTY_SCHEDULED_RESEARCH` to `on`.

Chats keep their transcripts, so one may mention records the restore removed.

## Restoring one organization

There's no tooling for this. Restore a copy as above (steps 2 and 3), then copy that organization's rows back by `organization_id` by hand, parent tables before the tables that reference them.
