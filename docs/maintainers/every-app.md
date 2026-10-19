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

## Two shapes, one code path

Identity is the same in both; the deploy picks the shape.

|                    | First party                                                                      | Fork                                                    |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Who deploys it     | Every App, as a shared app of the hosted gateway                                 | An organization: a self-hosted gateway, or its own copy |
| Organizations      | Every organization on the gateway, from one Worker                               | One                                                     |
| `EVERY_APP_ORG_ID` | Unset: the organization comes from each request's identity                       | Set by the deploy: any other organization is refused    |
| `EVERYAPP_SHARED`  | `1` (set by `everyapp deploy --shared`): every gateway call must say whose it is | Unset                                                   |
| Database           | Postgres through Hyperdrive (`DATABASE_PROVIDER=postgres`)                       | D1                                                      |
| Deploy             | `pnpm deploy:everyapp:first-party`                                               | `pnpm deploy:everyapp`                                  |

In both shapes the token's organization id is the CRM's organization id: the first request from a member of a new organization creates its `organization` row, the member's `user` row and a `member` row mirroring their role (`src/server/auth/delegated-organization.ts`). Every CRM table hangs off `organization_id`. Authorization always reads the organization and role from the signed token, never from a member row, so a member the gateway removes has no way back in.

Unlike OpenSEO, a fork doesn't map its organization to a `shared-workspace` row: OpenSEO keeps that for data its older self-host modes wrote, and the CRM has none.

## Whose calls they are

A first-party deployment serves every organization from one Worker, so every model and Context.dev call says whose it is (`src/server/lib/gateway-attribution.ts`):

- While serving a request (pages, server functions, the gateway's tool calls), the request's signed identity is forwarded.
- Work no request started (the minute cron, the agent's sessions) runs inside `forOrganization(organizationId, ...)`, which sends `x-everyapp-org`. The gateway accepts it for an active organization with a live member.

`FIRST_PARTY_SCHEDULED_RESEARCH=off` holds the agent's scheduled research on a first-party deployment (`src/server/lib/deployment-tier.ts`); research a person asks for always runs.

## Run it locally

With the Every App repository beside this one (`../private-every-app`, `pnpm install` run there; the SDK and CLI are linked until they're published):

```bash
pnpm install
pnpm dev
```

`everyapp dev` applies the D1 migrations to a local database in `.cloudflare/state`, then starts a gateway-lite on `http://crm.localhost:8787` with a seeded owner (`dev@everyapp.localhost` in `dev-org`) and the real identity checks. With no gateway binding locally, the model and Context.dev calls use your own `OPENROUTER_API_KEY` and `CONTEXT_API_KEY` from `.dev.vars`. Local runs are the first-party shape on D1 (`everyapp dev` pins no organization); to see what a fork's owners see, such as the setup commands, set `DEPLOYMENT_TIER=fork` in `.dev.vars`.

The first-party shape runs locally too, against a local Postgres:

```bash
POSTGRES_DATABASE_URL=postgres://<user>:<password>@localhost:5432/<database> pnpm db:migrate:pg
# .dev.vars:
# CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://<user>:<password>@localhost:5432/<database>
OPEN_CRM_DATABASE=postgres pnpm dev
```

`everyapp dev` applies no migrations in this shape (it only migrates D1), hence the first step. The local Hyperdrive refuses a connection string without a password, even when the database itself doesn't ask for one. When a `.dev.vars` exists, the SDK reads the connection string from it alone, not from the environment.

## Deploy it

**Fork**, to the gateway in your Cloudflare account:

```bash
pnpm deploy:everyapp
```

`everyapp deploy` registers the app, creates its D1 database and R2 bucket, builds the Worker, checks the schema has no migration drift, migrates D1 after a restore point, uploads, and binds it to the gateway. The gateway holds the provider keys for every app (`everyapp secret set OPENROUTER_API_KEY --for gateway`, and `CONTEXT_API_KEY`). The CRM's one optional setting of its own is `GITHUB_TOKEN` (`everyapp secret set GITHUB_TOKEN`).

**First party**, as a shared app of the hosted gateway (a platform owner or admin):

```bash
# .everyapp/secrets.env (never committed or uploaded):
# POSTGRES_DATABASE_URL=postgres://<user>:<password>@<host>:<port>/<database>
pnpm deploy:everyapp:first-party   # OPEN_CRM_DATABASE=postgres everyapp deploy --shared
```

With `OPEN_CRM_DATABASE=postgres`, `everyapp.config.ts` declares Postgres (`database.provider`), a `HYPERDRIVE` binding and the Postgres migrations instead of D1: the deploy creates the Hyperdrive config from the database URL, runs `drizzle-kit migrate` with `drizzle/pg.config.ts` before it uploads, and registers the app as shared (no `EVERY_APP_ORG_ID`, `EVERYAPP_SHARED=1`). The first party bills usage on the Autumn environment it shares with OpenSEO's first party (not app.openseo.so's), so it also needs `everyapp secret set AUTUMN_SECRET_KEY` ([billing.md](billing.md)).

## Database

One schema in two dialects: SQLite (`src/db/*.schema.ts`) and Postgres (`src/db/pg/*.schema.ts`), kept structurally identical by `src/db/schema-parity.test.ts`. `pnpm db:generate` writes both migration sets (`drizzle/sqlite`, `drizzle/pg`). D1 has no interactive transactions and no row locks, so the code has none on either backend: atomic multi-statement writes go through `runBatch`, and exclusivity comes from unique (often partial) indexes and conditional updates. Tests run repositories against real SQLite and, where the dialect matters, Postgres (PGlite): `src/server/testing/testDb.ts`.
