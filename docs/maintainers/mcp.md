# MCP tools

The CRM's API is its MCP tools. The Every App gateway serves them on its own `/mcp`, beside every other app's as `crm_<tool>` (an OAuth connection or a personal access token), and on the CRM's host at `/mcp` under their own names (a personal access token, or the member's browser session). The gateway signs the person in, applies the connection's scopes and calls a tool over `/__everyapp/tools/call` with an identity minted for that one call. The CRM never speaks MCP itself (`src/server/everyapp/tools.ts`).

## How they're organized

- One file per feature in `src/server/everyapp/tools/`, each tool a `crmTool()` (`crm-tool.ts`): a description that says when to use it, a risk, a zod input and a zod output. The handler runs as the caller, in their organization, and calls the feature's service with the same `requireOrgPermission` checks as the server function for the same action. A new tool joins the map in `tools.ts`.
- The SDK checks the input before the handler and the result after it, and keeps only the fields the output schema names, so outputs carry what an agent uses rather than the service's whole row.
- People are named by email (owners, members, user fields); records by the ids `search_records` and the list tools return. Lists are paged: records 25 a page, a timeline 30 with a cursor, members, agents and Slack channels 50.
- An `AppError` reaches the model as its message, a bare code as its standard sentence. Any other failure, and `INTERNAL_ERROR`, reaches it as the SDK's "Internal error in crm (ref …)", logged with that reference.
- Left out: connecting a mailbox or Slack, and billing checkout (browser flows); building, changing and deploying a team agent (deploying is where a person approves what it may do); the agent's chats (the app's own conversations); CSV import; the tracker's verify and site id rotation; what the gateway owns (roles, invitations, tokens, SSO).

## Risk levels

| Risk          | What it means                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`        | Changes nothing. Every connection may call it, a read-only one (`mcp:read`) included.                                                                                                 |
| `write`       | Creates or changes data, archiving included, since every archive has a restore. Read & write connections (`mcp:write` or `*`) and browser sessions.                                   |
| `destructive` | Deletes for good: `bulk_purge`, `delete_activity`, `delete_field`, `delete_saved_view`, `delete_team_agent`. The gateway hides and refuses these for everyone until it has approvals. |

`catalog.test.ts` holds the line: the read tools are exactly the `list_`, `get_` and `search_` tools. The gateway serves at most 100 tools an app, and drops a tool whose input or output schema is over 20 KiB.

## Testing

- `toolTestSupport.ts` calls a tool through the SDK's tools endpoint as the gateway does, with an identity minted for the call (the dev keypair) and a connection's scopes. The tests in `src/server/everyapp/tools/*.test.ts`, one per tool family, run on real SQLite.
- `pnpm dev` serves `/mcp` as the seeded owner, read & write:

```bash
curl -s http://crm.localhost:8787/mcp -H 'authorization: Bearer dev' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_records","arguments":{"query":"acme"}}}'
```

MCP Inspector and Claude Code (`{ "type": "http", "url": "http://crm.localhost:8787/mcp" }` with that header) work against it too. `everyapp dev` makes no read-only connection; the tests cover the scopes.
