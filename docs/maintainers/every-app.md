# Open CRM on an Every App gateway

The CRM runs only behind an [Every App](https://everyapp.com) gateway. The gateway does what each deployment would otherwise set up for itself:

| Concern                                  | Where it lives                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, sign-out, who may open the CRM  | The gateway's users, organizations, roles and per-app access                                                                                |
| People and the workspace                 | Gateway `sub` → `user` row; the organization and role come from the signed identity on every request                                        |
| Teams, invitations, roles                | The gateway's; the CRM's Members tab only mirrors who has opened it                                                                         |
| MCP                                      | The gateway's one MCP connector lists the CRM's tools as `crm_<tool>`; the CRM never speaks MCP itself ([mcp.md](mcp.md))                   |
| The agent's model and its web research   | The gateway's AI proxy holds `OPENROUTER_API_KEY` (`src/server/lib/openrouter.ts`)                                                          |
| Company brand data, LinkedIn, extraction | The gateway holds `CONTEXT_API_KEY` (the `context` capability, `src/server/lib/provider-access.ts`)                                         |
| Members' mail and calendar               | The gateway holds the Google and Microsoft OAuth clients; the CRM keeps each member's tokens ([mail-and-calendar.md](mail-and-calendar.md)) |

## One organization per deployment

An organization deploys the CRM to its own gateway, and the deploy pins it to that organization (`EVERY_APP_ORG_ID`): a token for any other organization is refused. `everyapp dev` pins none, and its local gateway signs in only its seeded owner.

The token's organization id is the CRM's organization id: the first request from a member creates the `organization` row, the member's `user` row and a `member` row mirroring their role (`src/server/auth/delegated-organization.ts`). Every CRM table hangs off `organization_id`. Authorization always reads the organization and role from the signed token, never from a member row, so a member the gateway removes can't open the CRM or call its tools again. The gateway never tells the CRM whom it removed, though, so their `member` row stays, and so does anything they connected: see "Removing a member" below.

The `member` row also notes when the CRM last saw the member (`last_seen_at`: a page, a server function or a tool call), at most once a day. A gateway that deletes a removed member's account gives them a new id if they're invited again; the old `user` row keeps the records it is on and gives its email up to the new one (`src/middleware/ensure-user/delegated.ts`).

Unlike OpenSEO, the CRM doesn't map its organization to a `shared-workspace` row: OpenSEO keeps that for data its older self-host modes wrote, and the CRM has none.

## Removing a member

1. Remove them at the gateway. From then on, no request of theirs reaches the CRM.
2. In Settings → Connections, an owner or admin finds their mailbox under "Members' mailboxes" and disconnects it (Google's grant is withdrawn, as when the member disconnects it). "Delete synced data" there also removes what it brought in.
3. Their companies, contacts and deals keep them as owner until someone reassigns them.

Without step 2, their mailbox keeps syncing until the CRM has gone 30 days without seeing them: the daily cron then pauses their syncs (`MemberMailboxService.pauseUnseen`), and they resume if the member comes back.

## Whose calls they are

Every model and Context.dev call says whose it is (`src/server/lib/gateway-attribution.ts`):

- While serving a request (pages, server functions, the gateway's tool calls), the request's signed identity is forwarded.
- Work no request started (the minute cron, the agent's sessions) runs inside `forOrganization(organizationId, ...)`, which sends `x-everyapp-org`. The gateway accepts it for an active organization with a live member.

## Run it locally

With the Every App repository beside this one (`../private-every-app`, `pnpm install` run there; the SDK and CLI are linked until they're published):

```bash
pnpm install
pnpm dev
```

`everyapp dev` applies the D1 migrations to a local database in `.cloudflare/state`, then starts a gateway-lite on `http://crm.localhost:8787` with a seeded owner (`dev@everyapp.localhost` in `dev-org`) and the real identity checks. With no gateway binding locally, the model and Context.dev calls use your own `OPENROUTER_API_KEY` and `CONTEXT_API_KEY` from `.dev.vars`.

## Deploy it

To the gateway in your Cloudflare account:

```bash
pnpm deploy:everyapp
```

`everyapp deploy` registers the app, creates its D1 database and R2 bucket, builds the Worker, checks the schema has no migration drift, migrates D1 after a restore point, uploads, and binds it to the gateway. The gateway holds the provider keys for every app (`everyapp secret set OPENROUTER_API_KEY --for gateway`, and `CONTEXT_API_KEY`). The CRM's one optional setting of its own is `GITHUB_TOKEN` (`everyapp secret set GITHUB_TOKEN`).

## Database

D1, with the schema in `src/db/*.schema.ts`; `pnpm db:generate` writes its migrations (`drizzle/sqlite`). D1 has no interactive transactions and no row locks, so the code has none: atomic multi-statement writes go through `runBatch`, and exclusivity comes from unique (often partial) indexes and conditional updates. Tests run repositories against real SQLite (libSQL, in memory, with every migration applied): `src/server/testing/testDb.ts`.
