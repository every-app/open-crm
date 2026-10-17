# REST API

The CRM serves a versioned REST API under `/api/v1/` on its own host, for scripts and tools that don't speak MCP. Its OpenAPI 3.1 document is `GET /api/v1/openapi.json`. Settings → API Keys tells members how to call it.

## Authentication is the gateway's

The CRM stores no API keys. A member makes a **personal access token** (`epat_…`) on their Every App gateway (Admin → Tokens, `/admin/tokens`) and sends it as `Authorization: Bearer epat_…`. The gateway's perimeter checks the token on every request (not revoked or expired, the member still in the token's organization, and the token bound to this app if it was made for one), strips it, and signs the member's identity onto the forwarded request like any other. The token never reaches the CRM.

What the CRM sees is the SDK's `EveryAppUser`, which `src/server.ts` hands to the API:

| Call            | `channel` | `actor.sub`      | `scopes`                        |
| --------------- | --------- | ---------------- | ------------------------------- |
| Token           | `api`     | `pat:<token id>` | the token's, `["*"]` by default |
| Browser session | `web`     | the member's id  | `["*"]`                         |

A token acts in the organization it was made in, with the member's current role there. Bearer requests skip the gateway's CSRF check, so `curl` needs no `Origin`. A gateway behind Cloudflare Access lets only `/mcp` and public routes through without an Access login, so there the API needs Access to let `/api/v1/*` through too.

## Scopes

The gateway enforces only `mcp:` scopes (a token holding nothing else reaches only `/mcp`). The CRM checks its own:

- A `GET` needs `api:read` or `api:write`; any other method needs `api:write`. `*` holds both.
- Server functions and the agent's chats refuse a credential without `*` (`src/middleware/ensure-user/everyApp.ts`), so a read-only token can't write through the UI's RPC instead.

The gateway's Tokens page makes `*` tokens. A read-only token is made with `scopes: ["api:read"]` through the gateway's `createUserToken`.

## One handler path

Each endpoint (`src/server/api/routes/<feature>.ts`) is an `apiRoute()`: method, path, the feature's own Zod input schema, and a handler that calls the feature's service with the same context and the same `requireOrgPermission` checks as the matching server function. The API layer holds no business logic and no queries. `src/server/api/handler.ts` matches the route, checks scopes, resolves the context, builds the input from the path parameters plus the query string (`GET`, `DELETE`) or the JSON body, validates it, and maps errors.

A query string is read the way the schema expects it: numbers, booleans, and repeated keys for arrays (`inputSchema.ts`, from the schema's JSON Schema). Inputs with nested objects (list filters) use `POST …/search` with a JSON body, as the original did.

Errors answer with the `AppError` code's HTTP status and `{ code, message, issues? }`: 400 `VALIDATION_ERROR` (with `issues` from Zod), 401, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429, 502/503, 500. A client error carries the service's message, as MCP tools do; a server fault only the code's standard copy.

The OpenAPI document is built on request from the same schemas (`z.toJSONSchema`, input side). Responses are documented as JSON without a schema: the services return TypeScript types, not Zod schemas.

## Departures from the original CRM's API

The original served every tRPC procedure under `/rest` with `x-api-key`. The port keeps its resource names and paths (`POST /companies/search`, `PATCH /deals/{id}/stage`, `POST /contacts/bulk-archive`, `DELETE /deals/{dealId}/contacts/{contactId}`, …) with these changes:

- The prefix is `/api/v1`, and the credential is a gateway token in `Authorization`.
- `PATCH /<records>/{id}` takes the changed fields at the top level of the body, not under `data`.
- A timeline names its record as `?companyId=`, `?contactId=` or `?dealId=`, exactly one.
- Custom field values live under the record: `GET`/`PATCH /companies/{id}/fields` (and contacts, deals).
- Left out: API key management, SSO, Slack, Google and Microsoft, tracking, agents and conversations, workspace changes and member roles (the gateway's), and settings beyond currencies.
