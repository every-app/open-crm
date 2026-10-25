# OpenCRM on an Every App gateway

The CRM runs only behind an [Every App](https://everyapp.com) gateway. The gateway does what each deployment would otherwise set up for itself:

| Concern                                  | Where it lives                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, sign-out, who may open the CRM  | The gateway's users, organizations, roles and per-app access                                                                                                    |
| People and the workspace                 | Gateway `sub` → `user` row; the organization and role come from the signed identity on every request                                                            |
| Teams, invitations, roles                | The gateway's; the CRM's Members tab only mirrors who has opened it                                                                                             |
| MCP                                      | The gateway's one MCP connector lists the CRM's tools as `crm_<tool>`; the CRM never speaks MCP itself ([mcp.md](mcp.md))                                       |
| The agent's model                        | The gateway's default model (`ai.chat`): its operator picks the provider and model, any one model provider's key opens the CRM (`src/server/lib/gateway-ai.ts`) |
| Web research                             | The gateway's AI proxy, pinned to OpenRouter (optional; `OPENROUTER_API_KEY`, `src/server/lib/openrouter.ts`)                                                   |
| Company brand data, LinkedIn, extraction | The gateway holds `CONTEXT_API_KEY` (the `context` capability, `src/server/lib/provider-access.ts`)                                                             |
| Members' mail and calendar               | The gateway holds the Google and Microsoft OAuth clients; the CRM keeps each member's tokens ([mail-and-calendar.md](mail-and-calendar.md))                     |

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

`everyapp dev` applies the D1 migrations to a local database in `.cloudflare/state`, then starts a gateway-lite on `http://crm.localhost:8787` with a seeded owner (`dev@everyapp.localhost` in `dev-org`) and the real identity checks. With no gateway binding locally, the model and Context.dev calls use your own keys from `.dev.vars` (`.dev.vars.example` lists them; `pnpm dev` names any that are missing): the SDK resolves the default model on them in the gateway's order, OpenRouter first, and web research needs `OPENROUTER_API_KEY` itself. The default model in local development needs `everyapp` and `@every-app/sdk` 0.3.0-rc.2 or later: 0.3.0-rc.1 refuses the manifest's `ai.chat` (`ai: Unrecognized key: "chat"`) and has no local fallback for the default route.

## Deploy it

To the gateway in your Cloudflare account:

```bash
pnpm deploy:everyapp
```

`everyapp deploy` registers the app, creates its D1 database and R2 bucket, builds the Worker, checks the schema has no migration drift, migrates D1 after a restore point, uploads, and binds it to the gateway. What the CRM needs set is below: the deploy ends by saying which required settings are still missing, `pnpm everyapp status` lists every one, and the gateway's home shows the CRM as "Needs setup" until the required ones are set.

## Settings

The manifest (`everyapp.config.ts`) declares each setting with its need and why. A required setting keeps the gateway from opening the CRM until it is set. An optional one is a single feature's: the CRM opens without it, and the feature says what is missing where it is used.

| Setting                                                        | Held by | Need     | What it unlocks                                                                                                                                  | Set with                                                                                                                                    |
| -------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A model provider's key (`OPENROUTER_API_KEY` first)            | gateway | required | The research agent's model, through the gateway's default model provider (`ai.chat`); `pnpm everyapp ai default <provider>[/<model>]` picks it   | `pnpm everyapp secret set OPENROUTER_API_KEY`, or another provider's key                                                                    |
| `OPENROUTER_API_KEY`                                           | gateway | optional | Web research: Perplexity's Sonar models and OpenRouter's web search (the same key also serves the default model)                                 | `pnpm everyapp secret set OPENROUTER_API_KEY`                                                                                               |
| `CONTEXT_API_KEY`                                              | gateway | required | Company brand data, LinkedIn profiles and website extraction                                                                                     | `pnpm everyapp secret set CONTEXT_API_KEY`                                                                                                  |
| `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` | gateway | optional | Members connect Gmail and Google Calendar                                                                                                        | `pnpm everyapp secret set GOOGLE_WORKSPACE_CLIENT_ID GOOGLE_WORKSPACE_CLIENT_SECRET`                                                        |
| `MICROSOFT_365_CLIENT_ID`, `MICROSOFT_365_CLIENT_SECRET`       | gateway | optional | Members connect Outlook                                                                                                                          | `pnpm everyapp secret set MICROSOFT_365_CLIENT_ID MICROSOFT_365_CLIENT_SECRET`                                                              |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`                       | gateway | optional | The workspace connects Slack, for team agents                                                                                                    | `pnpm everyapp secret set SLACK_CLIENT_ID SLACK_CLIENT_SECRET`                                                                              |
| `TOKEN_ENCRYPTION_KEY`                                         | CRM     | optional | Every mail, calendar and Slack connection: their tokens are encrypted under it. 32 or more random characters; changing it means connecting again | `TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" pnpm everyapp secret set TOKEN_ENCRYPTION_KEY --app crm --from-env TOKEN_ENCRYPTION_KEY` |
| `GITHUB_TOKEN`                                                 | CRM     | optional | A higher GitHub rate limit when the agent matches people to profiles (any classic token with no scopes)                                          | `pnpm everyapp secret set GITHUB_TOKEN --app crm`                                                                                           |
| `AGENT_MODEL`                                                  | CRM     | optional | The model id the agent runs on, as the gateway's default provider names it; empty takes the operator's default                                   | `pnpm everyapp secret set AGENT_MODEL --app crm`                                                                                            |
| `ERASURE_SECRET`                                               | CRM     | optional | An operator's erasure requests, which it signs; set for the erasure and unset after ([runbook](runbooks/erase-organization.md))                  | `pnpm everyapp secret set ERASURE_SECRET --app crm`                                                                                         |

Where an optional setting is missing, the feature says so: the Google, Microsoft and Slack pages under Settings → Connections name the gateway settings an admin sets and, once the client is there, the `TOKEN_ENCRYPTION_KEY` with the command that sets it, which owners and admins run and a member is told to ask an admin for (`src/client/features/settings/SetupNotices.tsx`); GitHub lookups run unauthenticated, about 60 an hour; without OpenRouter, web research (`web_search`, `research_person`, `find_contact_socials`) answers that the gateway holds no OpenRouter key, with the command, and the agent's session leaves it out of what it can use for ten minutes after a refusal (`src/server/features/agent/lib/perplexity.ts`); without `AGENT_MODEL` the agent runs on the operator's default model; `/internal/erase-organization` answers 404.

## Database

D1, with the schema in `src/db/*.schema.ts`; `pnpm db:generate` writes its migrations (`drizzle/sqlite`). D1 has no interactive transactions and no row locks, so the code has none: atomic multi-statement writes go through `runBatch`, and exclusivity comes from unique (often partial) indexes and conditional updates. Tests run repositories against real SQLite (libSQL, in memory, with every migration applied): `src/server/testing/testDb.ts`.
