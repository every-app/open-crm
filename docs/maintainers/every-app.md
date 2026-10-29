# OpenCRM on an Every App gateway

The CRM runs only behind an [Every App](https://everyapp.com) gateway. The gateway does what each deployment would otherwise set up for itself:

| Concern                                 | Where it lives                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, sign-out, who may open the CRM | The gateway's users, organizations, roles and per-app access                                                                                |
| People and the workspace                | Gateway `sub` → `user` row; the organization and role come from the signed identity on every request                                        |
| Teams, invitations, roles               | The gateway's; the CRM's Members tab only mirrors who has opened it                                                                         |
| MCP                                     | The gateway's one MCP connector lists the CRM's tools as `crm_<tool>`; the CRM never speaks MCP itself ([mcp.md](mcp.md))                   |
| Members' mail and calendar              | The gateway holds the Google and Microsoft OAuth clients; the CRM keeps each member's tokens ([mail-and-calendar.md](mail-and-calendar.md)) |

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

Every gateway call (mail and calendar) says whose it is (`src/server/lib/gateway-attribution.ts`):

- While serving a request (pages, server functions, the gateway's tool calls), the request's signed identity is forwarded.
- Work no request started (the minute cron) runs inside `forOrganization(organizationId, ...)`, which sends `x-everyapp-org`. The gateway accepts it for an active organization with a live member.

## Run it locally

With Node.js 22.18+ and pnpm 10. The Every App SDK and CLI are the published packages `@every-app/sdk` and `everyapp`, pinned in `package.json`, so no checkout of the Every App repository is needed:

```bash
pnpm install
pnpm dev
```

`everyapp dev` applies the D1 migrations to a local database in `.cloudflare/state`, then starts a gateway-lite on `http://crm.localhost:8787` with a seeded owner (`dev@everyapp.localhost` in `dev-org`) and the real identity checks. The CRM's own settings for local runs go in `.dev.vars` (`.dev.vars.example` lists them).

## Deploy it

To the gateway in your Cloudflare account, from your Every App checkout (`pnpm everyapp install https://github.com/every-app/open-crm`, then `pnpm everyapp configure crm`; [docs/self-hosting.md](../self-hosting.md)), or with your own changes, from this directory with that checkout's CLI:

```bash
node ../every-app/packages/cli/bin/everyapp.js deploy
```

`everyapp deploy` (which `install` runs for a release) registers the app, creates its D1 database and R2 bucket, builds the Worker, checks the schema has no migration drift, migrates D1 after a restore point, uploads, and binds it to the gateway. What the CRM can be given is below; none of it is required, and `pnpm everyapp status` lists every one.

## Settings

The manifest (`everyapp.config.ts`) declares each setting with its need and why. Each is optional, a single feature's: the CRM opens without it, and the feature says what is missing where it is used.

| Setting                                                        | Held by | Need     | What it unlocks                                                                                                                           | Set with                                                                                                                                    |
| -------------------------------------------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` | gateway | optional | Members connect Gmail and Google Calendar                                                                                                 | `pnpm everyapp secret set GOOGLE_WORKSPACE_CLIENT_ID GOOGLE_WORKSPACE_CLIENT_SECRET`                                                        |
| `MICROSOFT_365_CLIENT_ID`, `MICROSOFT_365_CLIENT_SECRET`       | gateway | optional | Members connect Outlook                                                                                                                   | `pnpm everyapp secret set MICROSOFT_365_CLIENT_ID MICROSOFT_365_CLIENT_SECRET`                                                              |
| `TOKEN_ENCRYPTION_KEY`                                         | CRM     | optional | Every mail and calendar connection: their tokens are encrypted under it. 32 or more random characters; changing it means connecting again | `TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" pnpm everyapp secret set TOKEN_ENCRYPTION_KEY --app crm --from-env TOKEN_ENCRYPTION_KEY` |
| `ERASURE_SECRET`                                               | CRM     | optional | An operator's erasure requests, which it signs; set for the erasure and unset after ([runbook](runbooks/erase-organization.md))           | `pnpm everyapp secret set ERASURE_SECRET --app crm`                                                                                         |

Where an optional setting is missing, the feature says so: the Google and Microsoft pages under Settings → Connections name the gateway settings an admin sets and, once the client is there, the `TOKEN_ENCRYPTION_KEY` with the command that sets it, which owners and admins run and a member is told to ask an admin for (`src/client/features/settings/SetupNotices.tsx`); without `ERASURE_SECRET`, `/internal/erase-organization` answers 404.

## Database

D1, with the schema in `src/db/*.schema.ts`; `pnpm db:generate` writes its migrations (`drizzle/sqlite`). D1 has no interactive transactions and no row locks, so the code has none: atomic multi-statement writes go through `runBatch`, and exclusivity comes from unique (often partial) indexes and conditional updates. Tests run repositories against real SQLite (libSQL, in memory, with every migration applied): `src/server/testing/testDb.ts`.
