# Agent guidance

Open CRM is the open-source CRM from [trycompai/crm](https://github.com/trycompai/crm), ported onto the Every App gateway and OpenSEO's stack: TanStack Start on Cloudflare Workers, Drizzle on D1, and the agent on Cloudflare's Think. When in doubt, do it the way OpenSEO does.

## Engineering principles

- Prefer simple, readable, flat code with minimal indirection.
- Search for existing implementations and installed libraries before creating new helpers or abstractions.
- Abstract when it prevents meaningful drift and makes the result simpler to maintain. Avoid speculative or one-use abstraction layers.
- Keep product data normalized and relationships explicit. Do not encode relational data in JSON or text merely to avoid joins.
- For new backend functionality, default to: TanStack server function (`src/serverFunctions/<feature>.ts`) → service (`src/server/features/<feature>/services/`) → repository (`src/server/features/<feature>/repositories/`). Input schemas live in `src/types/schemas/<feature>.ts`; client query options and components in `src/client/features/<feature>/`; routes in `src/routes/` stay thin.
- Use idiomatic TypeScript. Use Zod to validate untrusted data and narrow runtime values at trust boundaries, including JSON columns read back from the database.
- Prefer idiomatic TanStack Query, Router, and Form patterns for server state, routing, and submitted forms (`useAppForm`).
- shadcn components in `src/client/components/ui/` are built on Base UI, not Radix. Compose them with the `render` prop, not `asChild`.

## Tenancy (the invariant)

- Identity comes only from the Every App gateway's signed token (`src/middleware/ensure-user/everyApp.ts`). The token's organization is the CRM's organization. An organization deploys the CRM to its own gateway, and the deploy pins it there (`EVERY_APP_ORG_ID`); any other organization is refused.
- Every tenant table has `organization_id`. Every repository function takes `organizationId` and filters by it on every read, update and delete, including lookups by id. A record id from the client is never trusted on its own.
- Roles come from the token (`context.role`), never from `member` rows, which only mirror the gateway. Gate owner/admin actions with `requireOrgPermission` (`src/server/auth/org-gate.ts`) and hide them on the client with `hasOrgPermission`.
- Gateway calls (models, Context.dev) must say whose they are: inside a request the identity is forwarded automatically; background work (the agent, the cron) runs inside `forOrganization(organizationId, ...)` (`src/server/lib/gateway-attribution.ts`).

## Database

- The schema is SQLite (`src/db/*.schema.ts`) on D1. After changing it, run `pnpm db:generate`.
- Change tables additively: new tables, new nullable or defaulted columns, new indexes. Changing a column's type, nullability or default makes drizzle rebuild the SQLite table, and on D1 the rebuild's `DROP TABLE` fires every `ON DELETE cascade` into it, deleting rows in the tables that reference it. Drop or rename a column or table only a release after the last code that read it, in a migration marked `-- everyapp:contract <release>`. `src/db/release-migrations.test.ts` refuses both otherwise ([database.md](docs/maintainers/database.md)).
- Import `db` from `@/db` and tables from `@/db/schema`.
- There are no interactive transactions and no locks on D1. Atomic multi-statement writes go through `runBatch` (`@/db/runBatch`); exclusivity comes from unique (often partial) indexes and conditional writes (`UPDATE ... WHERE <expected state> RETURNING`). Never call `db.batch` or `db.transaction` directly.
- Drizzle's SQLite `onConflictDoNothing({ where })` emits invalid SQL for partial indexes; use `onConflictDoUpdate({ targetWhere })` (see `AgentTaskRepository.insertIfAbsent`).
- Timestamps are ISO 8601 text (`new Date().toISOString()`), matching the column default, so they compare as strings. Money and rates are doubles rounded on write. Case-insensitive search uses `lower(column) like lower(pattern)`.
- Mind D1's 100-bound-parameter limit per statement: chunk large `IN` lists and bulk inserts (`executeInBatches`).

## Testing

- Don't add tests just for the sake of it. A test exists to enforce core behavior or a hard-to-spot edge case that could actually occur.
- Test repositories and services against a real database: `createSqliteTestDb` (`src/server/testing/testDb.ts`). Every new repository gets an organization-isolation test (`seedTwoOrganizations`).
- Statically import the module under test. `vi.mock` is hoisted, so per-test `await import()` and `vi.resetModules()` are banned unless module-level state must reset.
- `beforeEach` sets default mock return values only. Vitest's `clearMocks` already resets call state.
- Fixtures contain only the fields the test asserts on or the types require.
- Don't mock ORM builder chains. Don't export a function only so a test can reach it.

## Commands

- `pnpm dev`: `everyapp dev` (a local gateway with a seeded dev owner, D1, the real identity checks) at `http://crm.localhost:8787`.
- `pnpm build:dev` (the dev Worker), `pnpm build:prod` (the deployable Worker, tenant-neutral as `everyapp deploy` builds it), `pnpm types:check`, `pnpm lint`, `pnpm knip`, `pnpm test`, `pnpm format:write`.
- `pnpm db:generate` after any schema change.
- `pnpm ci:check` runs everything CI runs.

## Every App

- The CRM runs only behind an Every App gateway. Run it with `pnpm dev` (`everyapp dev`); deploy it only with `pnpm deploy:everyapp` (`everyapp deploy`), never with `cf deploy` or wrangler.
- `everyapp.config.ts` is the manifest: the CRM's resources (D1, the agent's Durable Object, its migrations), the gateway providers and capabilities it uses, its own `secrets` and its `public` routes. A secret the CRM reads must be listed there before `everyapp secret set` or `.dev.vars` carries it. Keys for local runs go in `.dev.vars` (copy `.dev.vars.example`), never in git.
- The everyapp skill, with every command and flag, is in the installed CLI at `node_modules/everyapp/skills/everyapp/SKILL.md`. Read it before running an everyapp command; never guess a flag. The CLI and the SDK are the published packages, pinned exactly in `package.json`; `pnpm everyapp deploy` from here can't update the Gateway, so deploys run from an Every App checkout (README, "Deploy it").

## Documentation audience

- `docs/` (except `docs/maintainers/`) is public, user-facing documentation.
- `docs/maintainers/` holds engineering decisions and maintenance notes.
