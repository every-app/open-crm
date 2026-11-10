# Release notes

What each release changes for a self-hosted CRM. To upgrade, see [Upgrading](self-hosting.md#upgrading).

## Unreleased

**Breaking changes:**

- Mail and calendar connect through Every App: the gateway runs the sign-in with Google or Microsoft, holds each member's connection and puts its token on the CRM's calls. The CRM keeps no tokens: migration `0002_mail_through_gateway` empties the ones it kept, so **every member connects Gmail, Calendar or Outlook again once** (Settings → Connections → Reconnect). Needs an Every App gateway with the simplified OAuth providers (`connectUrl`, connections per person and app). Register the gateway's redirect URIs (`https://<gateway>/connect/google-workspace/callback`, `https://<gateway>/connect/microsoft-365/callback`) on the Google and Microsoft clients; the CRM's `/integrations/<provider>/callback` routes are gone. Disconnect in the CRM stops capture; the connection itself is removed under Connected accounts on Every App.
- Removed the research agent, team agents and Slack. Companies and contacts are no longer researched or enriched, custom fields are no longer filled by an agent, and the agent builder, runs, chats and their sharing links are gone, with Settings → AI, the Slack connection, the `/agents` pages, `/health/dispatch`, `pnpm ops dispatch` and `pnpm ops requeue`. The MCP tools for team agents, Slack, research (`bulk_enrich`, `get_enrichment_queue`, `fill_field`) and contact suggestions are gone too. Logos and photos the agent already copied still show.
- The agent's Durable Object (`CrmAgent`) goes, with everything it stored: agent chats and research transcripts. Upgrading an install that had it needs `--allow-delete-durable-object-data` on `pnpm everyapp install` (or `deploy`), which otherwise refuses with `DURABLE_OBJECT_REMOVED`.
- The agent's tables stay in the database, unread, until a later release drops them.

**Settings:** the CRM no longer reads `TOKEN_ENCRYPTION_KEY`; unset it (`pnpm everyapp secret unset TOKEN_ENCRYPTION_KEY --app crm`). It no longer reads `OPENROUTER_API_KEY`, `CONTEXT_API_KEY`, the gateway's Slack client (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`), `GITHUB_TOKEN` or `AGENT_MODEL`. Unset the CRM's own (`pnpm everyapp secret unset GITHUB_TOKEN --app crm`, and `AGENT_MODEL`); the gateway's stay for any other app that uses them.

- Companies and Contacts are tabs under Directory. Workspace settings links directly to member management on Every App.
- Simplified onboarding, dashboard drill-downs, record details and activity filters. Archived records now live in Filters and show their deletion date; retention changes require confirmation.
- Empty sales metrics and charts stay hidden.
- Overview starts with the team's data; the owner filter appears only when deals have different owners. Workspace setup needs only a name. Added creator-owned company/deal defaults.
- New companies created through MCP belong to the caller unless `ownerEmail` names another member.
- Grouped settings into Workspace, Connections and Tracking. Added mobile settings navigation, CSV templates, simpler field setup and actionable connection errors.
- Removed the separate Members, Currencies and API settings routes. Use Workspace for members/currencies and Connections for API/MCP.
- MCP timeline task filters are now `open-tasks` and `completed-tasks` (previously `upcoming` and `done`); `notes` excludes calls, and `calls` is separate. Optional `due` filters tasks by overdue, upcoming or undated.
- A record sheet is one scroll, with no tabs; a deal has one stage control, with a Close deal menu for won, lost and unqualified. Overview leads with overdue tasks and lists. Connections lists mail and calendar first.
- While deals are off, search, record sheets, Overview, timelines and recent activity leave deals and their stage changes out (the MCP's `search_records`, `list_activities` and `get_timeline_counts` too). Turning deals back on shows them again.
- Lists: a saved view keeps the search, filters, sort and columns, not the list it was saved in. Edit list saves its details and stages together, and a stage only archived records are at can be removed. A CSV's Stage column sets each row's stage in the list it is imported into.

**Migrations:** `0002_mail_through_gateway` (data only: empties the stored mail tokens and pending connects, and marks every mail connection for reconnecting).

## 0.1.0

The first tagged release.

**Needs** an Every App checkout that includes commit `54f85b5d`, which gives the gateway the CRM's Google, Microsoft and Slack clients and takes the secrets its manifest lists (`git merge-base --is-ancestor 54f85b5d HEAD` in that checkout says whether it does), Node.js 22.18 or newer, and pnpm 10.

**Breaking changes:** none.

**Settings:**

- On the gateway: `OPENROUTER_API_KEY`, `CONTEXT_API_KEY`, and the Google, Microsoft and Slack OAuth clients ([self-hosting.md](self-hosting.md#give-the-agent-its-keys)).
- On the CRM, all optional: `TOKEN_ENCRYPTION_KEY`, needed before anyone connects mail, a calendar or Slack ([self-hosting.md](self-hosting.md#deploy-a-fork)); `GITHUB_TOKEN`; `OPENROUTER_MODEL` (since renamed `AGENT_MODEL`).
- The Slack app no longer needs `channels:history`, `groups:history`, `conversations.connect:write` or `links:write`.
- Settings → General → Research automatically, on by default.

**Migrations:** everything in `drizzle/sqlite`, which the deploy applies after taking a restore point.
