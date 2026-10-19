# Operating a deployed CRM

## Operator scripts

`pnpm ops` reads a deployed CRM's database directly, from this checkout, and prints JSON (`scripts/ops.ts`):

| Command                                                   | What it shows                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm ops organization <organization id or member email>` | The workspace, its model and credit holds, members, record counts, mail, calendar, Slack and tracking connections (never their tokens), open tasks by kind, tasks retired in the last day, and team agent runs by status.                  |
| `pnpm ops dispatch`                                       | The whole deployment: when each lane of the minute cron last ran (stalled after five minutes), the 20 organizations with the most work due and their holds, tasks retired in the last day, queued and failed runs, and mailbox checks due. |
| `pnpm ops requeue <task id>`                              | A dry run. With `--execute`, closes the task and queues a fresh copy due now: a copy, because a task's session keeps the token and lookup budgets it spent. It refuses a task a session holds, or one already queued again.                |

Where they read:

- A fork's D1 by default, through `everyapp db query`, with your Cloudflare login in the gateway's account.
- With `--local`, the database `pnpm dev` uses.
- With `--postgres`, the first party's, at `POSTGRES_DATABASE_URL` from the environment or `.everyapp/secrets.env`, where the first-party deploy reads it.

`/health/dispatch` shows one organization's queue; `pnpm ops dispatch` is the deployment's.

## Logs and checks

- Logs are under Workers & Pages → the CRM's Worker → Observability, kept 7 days, with traces of one request in ten. Workers Issues groups the errors.
- Check `/health` every minute, and `/health/dispatch` with an owner's personal access token every five minutes. Tokens expire, and the check fails from then: make a new one before it does.
- Restores are in [restore.md](restore.md).
