# Self-hosting Open CRM

Open CRM runs behind an Every App gateway. You deploy your own copy (a fork) to a gateway in your Cloudflare account, as this page describes.

## What you need

- **An Every App gateway.** The gateway is a Worker in your Cloudflare account that signs people in, decides who may open each app, and holds the provider keys apps use. If you don't have one yet, the steps below set it up.
- **A Cloudflare account on Workers Paid, with a domain on Cloudflare.** The gateway lives at a subdomain of it (for example `apps.your-company.com`) and the CRM one level below (`crm.apps.your-company.com`).
- **Node.js 22.18 or newer**, and **pnpm 10**.
- **A checkout of the Every App repository** beside this one, at `../private-every-app`, with `pnpm install` run there. The Every App SDK and CLI are not published yet, so the CRM's `package.json` links them from that checkout by path. The [release notes](release-notes.md) name the Every App commit each release needs.

```text
projects/
  private-every-app/   # the Every App repository, `pnpm install` run here
  open-crm/            # this repository
```

## Deploy a fork

```bash
git clone <your fork of this repository> open-crm
cd open-crm
pnpm install
```

If you don't have a gateway yet, set one up from either checkout. It logs you in to Cloudflare, deploys the gateway at the domain you choose, and opens a one-time link to create your owner account:

```bash
pnpm everyapp setup --domain apps.your-company.com
```

Then deploy the CRM from this checkout:

```bash
pnpm deploy:everyapp
```

The deploy registers the CRM with the gateway, creates its D1 database and R2 bucket, builds the Worker, migrates the database, uploads it, and binds it to the gateway. With no gateway in your account, the deploy offers to set one up first. When it finishes, the CRM appears on your gateway for every member of your organization.

The CRM has two optional settings of its own: `OPENROUTER_MODEL` ([below](#give-the-agent-its-keys)), and a GitHub token (any classic token with no scopes), which raises GitHub's rate limit when the agent matches people to GitHub profiles. Set the token after the first deploy:

```bash
pnpm everyapp secret set GITHUB_TOKEN
```

Before anyone connects mail, a calendar or Slack, give the CRM the key it encrypts their tokens with. Keep it safe: if it changes or is lost, everyone connects again.

```bash
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" pnpm everyapp secret set TOKEN_ENCRYPTION_KEY --from-env TOKEN_ENCRYPTION_KEY
```

## Give the agent its keys

The research agent's keys live on the gateway, never in the CRM. Set each once:

| Setting              | What it unlocks                                                                | Command                                                     |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `OPENROUTER_API_KEY` | The research agent and the chats on each record, including their web research  | `pnpm everyapp secret set OPENROUTER_API_KEY --for gateway` |
| `CONTEXT_API_KEY`    | Company logos and brand data, LinkedIn profile lookups, and website extraction | `pnpm everyapp secret set CONTEXT_API_KEY --for gateway`    |

Each command asks for the value at a hidden prompt, so the key never appears in your shell history. The change is live on the gateway at once, with no redeploy of the gateway or the CRM. The CRM notices a newly set key on its own, with no restart: work waiting for the model key starts within about ten minutes, and logos and photos waiting for the Context.dev key within about five.

The agent runs on GPT-6 Luna through OpenRouter. To use another OpenRouter model, set its id on the CRM (the key stays on the gateway):

```bash
pnpm everyapp secret set OPENROUTER_MODEL
```

The model must have a Zero Data Retention endpoint on OpenRouter: every call asks for zero retention and no data collection.

### Mail and calendar

Members connect their own Gmail and Google Calendar, or Outlook, from Settings → Connections, and the CRM files their work conversations and meetings on companies and contacts. It only reads: it never sends, changes or drafts mail. The OAuth clients live on the gateway too, so set up whichever you want people to use:

1. **Google.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), enable the Gmail API and the Google Calendar API, create an OAuth client of type _Web application_, and add the redirect URI `https://<crm host>/integrations/google/callback` (for example `https://crm.apps.your-company.com/integrations/google/callback`). On the consent screen, add the scopes `gmail.readonly` and `calendar.readonly`.
2. **Microsoft.** In [Microsoft Entra](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade), register an application for _accounts in any organizational directory and personal Microsoft accounts_, add the _Web_ redirect URI `https://<crm host>/integrations/microsoft/callback`, add the delegated Microsoft Graph permissions `User.Read`, `Mail.Read` and `offline_access`, and create a client secret.
3. Give the gateway each client:

```bash
pnpm everyapp secret set GOOGLE_WORKSPACE_CLIENT_ID GOOGLE_WORKSPACE_CLIENT_SECRET --for gateway
pnpm everyapp secret set MICROSOFT_365_CLIENT_ID MICROSOFT_365_CLIENT_SECRET --for gateway
```

Settings → Connections shows the exact redirect URI for your CRM to owners and admins, and each card says when its client isn't set up yet.

Gmail's read scope is one Google restricts. If everyone who connects is in your own Google Workspace, make the consent screen _Internal_ and no review is needed. An _External_ consent screen needs Google's verification and a yearly security assessment before people outside your Workspace can connect Gmail. Left in _Testing_, it takes at most 100 test users, and their connections stop working after 7 days.

Microsoft client secrets expire after the period you pick when you create one, from 90 days to 24 months. Set a new one with the same command before it does.

Organizations that let only admins consent send members to an approval page. An admin opens the **Grant admin consent** link on the member's Microsoft page in the CRM, or in Microsoft Entra goes to _Enterprise applications_, the app, _Permissions_, **Grant admin consent**.

### Slack

Team agents post to Slack through a Slack app whose client the gateway holds. At [api.slack.com/apps](https://api.slack.com/apps), create an app, add the redirect URL `https://<crm host>/integrations/slack/callback` under _OAuth & Permissions_, and add the bot token scopes `users:read`, `users:read.email`, `channels:read`, `groups:read`, `chat:write`, `chat:write.public`, `im:write`, `channels:join`, `channels:manage`, `groups:write`, `channels:write.invites` and `groups:write.invites`, and the user token scopes `channels:read`, `channels:write`, `groups:read` and `groups:write`. Then give the gateway its client:

```bash
pnpm everyapp secret set SLACK_CLIENT_ID SLACK_CLIENT_SECRET --for gateway
```

An owner or admin then connects the workspace's Slack from Settings → Connections. Joining and creating channels is theirs too, since it uses the token of whoever connected.

## Invite your team

Everyone in your organization on the gateway can open the CRM. Owners and admins invite people on the gateway, under Users → Invite user (`https://<gateway>/admin/users`). If the gateway can't send email, copy the invite link it shows and send it yourself. Settings → Members lists who has opened the CRM.

To remove someone, remove them on the gateway, then disconnect their mailbox under Settings → Connections → Members' mailboxes. Otherwise their mail and calendar keep syncing until 30 days after the CRM last saw them.

Owners can export all of the workspace's data from Settings → General.

## What works without keys

The CRM works as a CRM with no keys at all: companies, contacts, deals, tasks, notes, CSV import and export, custom fields, saved views, website tracking (Settings → Tracking & Analytics), and the MCP tools AI clients use. Clients that sign in with OAuth, such as claude.ai and ChatGPT, connect to your gateway's `/mcp`; the CRM's own `https://<crm host>/mcp` takes only a personal access token. Mail and calendar capture and posting to Slack need the OAuth clients above, and team agents need the model key.

Without a model key, the research agent pauses. Records it would research say "Waiting for setup", and the agent button on Overview says "Agent paused". Settings → General shows which key is missing and, on your own gateway, the command that sets it; owners and admins also see it as a step in Overview's Get started card. Nothing is lost while it waits: the agent does the work once the key is set.

With a model key but no Context.dev key, the agent still researches. Each company shows its website's favicon as its logo, and brand data stays empty.

## What the agent costs

On your own gateway, the agent spends your OpenRouter and Context.dev accounts. At their prices in October 2026:

- A new company gets a logo and brand lookup (10 Context.dev credits, $0.025), then a research session for its profile.
- A new contact gets a research session to identify them, and a photo search when there's somewhere to look (up to $0.05).
- A new record's research session makes at most two Context.dev lookups ($0.025 for a brand or a site's pages, $0.05 for a LinkedIn profile) and spends at most 500,000 input and 50,000 output tokens: $0.075 on GPT-6 Luna, at $0.10 and $0.50 per million, plus $0.01 for each web search. A company enriched on request, and the brief before a meeting with someone new, may make four or five lookups.

So researching a record costs at most about $0.25, plus its web searches. Context.dev bills credits at about $0.0025 each on its $19 plan, and its free plan's 1,000 credits a month buy 100 logo lookups. A team agent's run can spend up to 500,000 input and 40,000 output tokens, and its schedule can run as often as every minute.

The agent researches every record you add and, every five minutes, up to 500 records of each kind that were never researched. To bound the spend:

- Give the OpenRouter key the gateway holds a credit limit that resets daily, in [OpenRouter's key settings](https://openrouter.ai/settings/keys). $10 a day covers a team adding a few dozen records a day, and holds a large import to $300 a month.
- Turn off **Research automatically** in Settings → General (owners and admins). The agent then researches only what someone asks for, and new records wait.
- Import a large CSV with **Research new records** off. Those records are never researched automatically.

Records a website form or a calendar invite adds aren't researched until someone opens or enriches them, and a calendar adds at most 50 people an hour. With **Research automatically** off, an import's research waits even when **Research new records** is on. Agent tasks and their step logs older than 30 days are deleted daily.

Research and team agents read web pages only from the record's own site and pages their searches returned, and none once they've read captured mail.

## Website tracking

The tracking tag runs on your own website, for visitors who aren't signed in:

- If your site sends a Content-Security-Policy, allow the CRM's host (`https://<crm host>`) in `script-src` and `connect-src`.
- If Cloudflare Access protects your gateway's app hosts, bypass `/t/*` and `/health` on the CRM's host. The Every App repository's `docs/runbooks/cloudflare-access.md` shows how.
- The collector takes at most 600 events a minute from a site and 120 from one visitor, 120 requests a minute from one address to one site (600 across sites), and 50,000 events a day per organization. Forms create at most 50 contacts an hour. Anything over is dropped.
- Add `data-crm-ignore` to a form or a field to keep it out of tracking. Forms with a password field are never sent.

## Run it locally

```bash
pnpm install
pnpm dev
```

This starts the CRM behind a local gateway at http://crm.localhost:8787, signed in as a seeded dev owner. The first visit asks for a workspace name and website. Use `pnpm dev --port 8840` to pick another port.

There is no gateway holding keys locally, so the model and Context.dev calls use your own `OPENROUTER_API_KEY` and `CONTEXT_API_KEY` from a `.dev.vars` file in this checkout. Both are optional; without them the agent shows as not set up.

```bash
# .dev.vars
OPENROUTER_API_KEY=...
CONTEXT_API_KEY=...
```

## Health checks

`https://<crm host>/health` answers `200 {"status":"ok","database":"up"}` without signing in, or `503` when the database doesn't answer. Point an uptime monitor at it, checking every minute.

`https://<crm host>/health/dispatch` reports the research agent's queue: when each part last ran, its backlog and recent failures. It answers `503` when a part has stopped or work is overdue. Call it with a personal access token for the CRM, made by an owner or admin on the gateway, in an `Authorization: Bearer` header, every five minutes or so. Tokens expire (after 7 to 180 days, or on a date you pick), and the monitor fails from then on: make a new one before it does.

It also reports the database's size (`"database": {"provider": "d1", "sizeBytes": …}`). D1 refuses every write once a database reaches 10 GB, so watch it.

## Operations

### Backups

D1 keeps every change for 30 days (Time Travel), with nothing to set up. Each deploy also takes a restore point before it migrates, and prints the command that goes back to it.

For a copy outside Cloudflare, export the database with Wrangler, Cloudflare's other CLI, which asks you to log in the first time. The CRM's database is named like its Worker, `every-<org key>-crm` (`pnpm exec cf d1 list` shows it). An export blocks the database's other requests while it runs, so make it when nobody is working:

```bash
npx wrangler d1 export every-<org key>-crm --remote --output crm-backup.sql
```

The export is SQL, which `npx wrangler d1 execute <database> --remote --file crm-backup.sql` loads into an empty database.

Neither covers two things outside the database: agent chats and the research agent's transcripts, which live in the CRM's Durable Objects, and logos, photos and files attached to builder chats, in its R2 bucket. They aren't backed up.

### Restoring

To take the database back to a moment in the last 30 days, or to a deploy's restore point:

```bash
pnpm exec cf d1 time-travel restore <database id> --timestamp 2026-10-19T09:00:00Z
pnpm exec cf d1 time-travel restore <database id> --bookmark <bookmark the deploy printed>
```

A restore rewinds the whole database in place, so everything written since is lost. It prints a bookmark that undoes it. Chats and images aren't rewound, so a chat may mention a record the restore removed.

### Rolling back

To serve the previous version again, open the CRM's Worker in the Cloudflare dashboard (Workers & Pages → `every-<org key>-crm` → Deployments) and choose Rollback beside that version. A rollback leaves the database as it is: the older version runs on the migrated database, because migrations only add tables and columns. To undo a migration's changes to data too, restore the deploy's bookmark.

After a rollback, the CRM serves a version `pnpm deploy:everyapp` didn't upload, so the next deploy asks before replacing it. Run that deploy in a terminal: where it can't ask, as in CI, it stops without changing anything.

### Logs

Every deploy turns on Workers Logs and traces. Open them under Workers & Pages → `every-<org key>-crm` → Observability. Workers Paid keeps logs for 7 days, and Workers Issues groups the errors.

### Erasing an organization

To erase an organization and everything it stored, follow `docs/maintainers/runbooks/erase-organization.md`. It needs `ERASURE_SECRET`, set with `pnpm everyapp secret set ERASURE_SECRET` for the erasure and removed afterwards.

### Operator scripts

From this checkout, with your Cloudflare login, these read the deployed CRM's database and print JSON:

```bash
pnpm ops organization <organization id or member email>   # records, members, connections and the agent's queue
pnpm ops dispatch                                         # when the agent's lanes last ran, and the work waiting
pnpm ops requeue <task id>                                # a stuck task, back on the queue; add --execute to do it
```

## Upgrading

Releases are tagged (`v0.1.0`), and the [release notes](release-notes.md) list each one's breaking changes, new settings, migrations and the Every App commit it needs.

1. Merge the release's tag into your fork, and update the Every App checkout to at least the commit the notes name. Run `pnpm install` in both.
2. If the Every App checkout changed, run `pnpm everyapp setup` to upgrade the gateway. It keeps the gateway's data, users and apps.
3. Set any new settings the notes list, then run `pnpm deploy:everyapp` from the CRM checkout.

The deploy migrates the CRM's database after taking a restore point (a D1 Time Travel bookmark, which it prints), then uploads the new version.

If your fork changes the schema, change tables only by adding to them. On D1, a migration that rebuilds a table deletes the rows of every table that references it, and `pnpm test` refuses one.

## Troubleshooting

**The agent says "Waiting for setup".** The gateway has no model key. Set `OPENROUTER_API_KEY` on the gateway (see [Give the agent its keys](#give-the-agent-its-keys)); the CRM picks it up within about ten minutes. Settings → General shows Connected after the agent's next successful call.

**Settings → General says "Not checked yet".** The gateway is connected, and the agent finds out whether it holds a model key the first time it runs. It runs within a minute of new work being queued, for example when you add a company.

**No logos.** Logos and brand data come from Context.dev, and without it only a company's favicon. Set `CONTEXT_API_KEY` on the gateway.

**Can't sign in, or the app isn't found.** Run `pnpm everyapp status`. It shows the gateway's address and release, its owner, the apps it lists and whether it binds them, each address's certificate, any deploy in progress, and the command to run when something is off.
