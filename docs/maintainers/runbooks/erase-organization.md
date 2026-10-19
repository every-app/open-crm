# Erasing an organization

`scripts/erase-organization.ts` lists, then erases, everything one organization holds in a CRM deployment: every row of it, its people, its agents' Durable Objects, its R2 objects, and its Google and Slack grants. It is modelled on OpenSEO's `scripts/erase-user-data.ts` and its GDPR erasure runbook.

The work happens in the CRM's Worker, which holds the database (D1 or Postgres), the `CRM_AGENT` Durable Objects, the R2 bucket and the tokens. The script calls one public route, `POST /internal/erase-organization` (`src/server/features/erasure`), signing each request with `ERASURE_SECRET`. While that secret is unset, the route answers 404.

## Before you start

1. **Cut the organization's access at the gateway.** Delete the organization, or remove its members, so no request recreates it: the CRM creates an organization the first time one of its members opens it. The gateway never tells apps about either.
2. **Set the secret on the Worker,** a long random value, only for the erasure:

   ```bash
   pnpm everyapp secret set ERASURE_SECRET
   ```

3. **Write an operator env file,** untracked, holding the same value:

   ```dotenv
   CRM_URL=https://<crm host>
   ERASURE_SECRET=...
   ```

You need Node 22.18 or later, which runs the script's TypeScript as is.

## Run

First the dry run, which changes nothing:

```bash
node --env-file=<env file> scripts/erase-organization.ts --organization <organization id>
```

It prints the members, the row count of every table that holds any, the mailbox connections, the Slack workspace, the agent sessions, and the R2 objects. Check it's the organization you mean.

Then erase it, confirming with the same id:

```bash
node --env-file=<env file> scripts/erase-organization.ts --organization <organization id> \
  --execute --confirm <organization id>
```

The Worker erases in bounded steps (`OrganizationErasureService.eraseNext`), and the script calls it until it is done:

1. It stops what would write more: the workspace row (which the enrichment sweep starts from), mailbox checks, the tracking site (the collector refuses its site id), team agents' triggers, open research tasks and queued runs.
2. It withdraws grants: each member's mailbox is disconnected as Disconnect does it, so Google's grant is revoked unless another workspace uses that Google account. Slack's bot and user tokens are revoked with `auth.revoke`.
3. It destroys each agent session's Durable Object (record and builder chats, research tasks, team-agent runs), then forgets the rows that named it.
4. It deletes the R2 objects under `<organization id>/` and `builder-attachments/<organization id>/`.
5. It deletes the largest tables in batches, then the organization row, which cascades to every other row, and in the same batch its members' users.

Every step can run again, so after a failure, fix what the error says (Google not confirming a revocation, say) and run the same command again. When it's done, the script lists the organization again and fails unless nothing is left. Its final JSON is the erasure receipt: keep it with the request.

## After

- **Unset the secret:** `pnpm everyapp secret unset ERASURE_SECRET`.

## What it can't reach

- An agent session whose rows were already deleted (a purged record's research, for instance) has no name left to find its Durable Object by.
- Workers logs and database backups (D1 Time Travel, Postgres point-in-time recovery) expire under their own retention.
