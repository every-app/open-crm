# Erasing an organization

`scripts/erase-organization.ts` lists, then erases, everything one organization holds in a CRM deployment: every row of it, its people, its R2 objects, and its Google grants. It is modelled on OpenSEO's `scripts/erase-user-data.ts` and its GDPR erasure runbook.

The work happens in the CRM's Worker, which holds the database, the R2 bucket and the tokens. The script calls one public route, `POST /internal/erase-organization` (`src/server/features/erasure`), signing each request with `ERASURE_SECRET`. While that secret is unset, the route answers 404.

## Before you start

1. **Cut the organization's access at the gateway.** Delete the organization, or remove its members, so no request recreates it: the CRM creates an organization the first time one of its members opens it. The gateway never tells apps about either.
2. **Set the secret on the Worker,** a long random value, only for the erasure:

   ```bash
   pnpm everyapp secret set ERASURE_SECRET --app crm
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

It prints the members, the row count of every table that holds any, the mailbox connections, and the R2 objects. Check it's the organization you mean.

Then erase it, confirming with the same id:

```bash
node --env-file=<env file> scripts/erase-organization.ts --organization <organization id> \
  --execute --confirm <organization id>
```

The Worker erases in bounded steps (`OrganizationErasureService.eraseNext`), and the script calls it until it is done:

1. It stops what would write more: the workspace row, mailbox checks, and the tracking site (the collector refuses its site id).
2. It withdraws grants: each member's mailbox is disconnected as Disconnect does it, so Google's grant is revoked unless another workspace uses that Google account.
3. It deletes the R2 objects under `<organization id>/` and `builder-attachments/<organization id>/`.
4. It deletes the largest tables in batches, then the organization row, which cascades to every other row, and in the same batch its members' users.

Every step can run again, so after a failure, fix what the error says (Google not confirming a revocation, say) and run the same command again. When it's done, the script lists the organization again and fails unless nothing is left. Its final JSON is the erasure receipt: keep it with the request.

## After

- **Unset the secret:** `pnpm everyapp secret unset ERASURE_SECRET --app crm`.

## What it can't reach

- A Slack workspace the organization connected while the CRM had team agents: the erasure deletes its stored tokens but no longer revokes them at Slack. Ask the organization to remove the CRM's app from their Slack workspace (Slack → Settings → Manage apps).
- Workers logs and database backups (D1 Time Travel) expire under their own retention.
