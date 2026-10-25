# Release notes

What each release changes for a self-hosted CRM. To upgrade, see [Upgrading](self-hosting.md#upgrading).

## Unreleased

- Replaced Chat with Agents. Create and revise drafts through MCP with `get_agent_connections` and `save_team_agent_draft`; review and deploy them in the CRM.
- Companies and Contacts are tabs under Directory. Agents follows Deals in the sidebar; research status sits above the divider, aligned with the navigation rows. Workspace settings links directly to member management on Every App.
- Simplified onboarding, dashboard drill-downs, record details and activity filters. Archived records now live in Filters and show their deletion date; retention changes require confirmation.
- Home guides new users from a company straight into its first deal. Empty sales metrics and charts stay hidden, and optional model/provider setup no longer replaces the next sales action.
- Overview starts with the team's data; the owner filter appears only when deals have different owners. Workspace setup needs only a name. Added direct CSV import and guided MCP setup from Welcome, creator-owned company/deal defaults, and a dated follow-up action after the first deal.
- New companies created through MCP belong to the caller unless `ownerEmail` names another member.
- Grouped settings into Workspace, AI and Connections. Added mobile settings navigation, CSV templates, simpler field setup and actionable connection errors.
- Removed browser Chat routes and the separate Members, Currencies and API settings routes. Use Workspace for members/currencies, Connections for API/MCP, and AI for research setup. Record sheets use `details` and `activity`.
- MCP timeline task filters are now `open-tasks` and `completed-tasks` (previously `upcoming` and `done`); `notes` excludes calls, and `calls` is separate. Optional `due` filters tasks by overdue, upcoming or undated.

**Migrations:** none.

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
