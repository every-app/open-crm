# Operating a deployed CRM

## Operator scripts

`pnpm ops` reads a deployed CRM's database directly, from this checkout, and prints JSON (`scripts/ops.ts`):

| Command                                                   | What it shows                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm ops organization <organization id or member email>` | The workspace, members, record counts, and mail, calendar and tracking connections (never their tokens). |

Where they read:

- The deployed D1 by default, through `everyapp db query`, with your Cloudflare login in the gateway's account.
- With `--local`, the database `pnpm dev` uses.

## Logs and checks

- Logs are under Workers & Pages → the CRM's Worker → Observability, kept 7 days, with traces of one request in ten. Workers Issues groups the errors.
- Check the gateway's `https://<gateway host>/health` every minute (public, no token), and the CRM's `/health` with an owner's personal access token every five minutes (it isn't public). Tokens expire, and the check fails from then: make a new one before it does.
- Restoring D1 is in [self-hosting.md](../../self-hosting.md#restoring).
