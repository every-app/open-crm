# Self-hosting Open CRM

Open CRM runs behind an Every App gateway. You can deploy your own copy (a fork) to a gateway in your Cloudflare account, as this page describes. Every App also runs the CRM for organizations on its hosted gateway; there is nothing to set up there.

## What you need

- **An Every App gateway.** The gateway is a Worker in your Cloudflare account that signs people in, decides who may open each app, and holds the provider keys apps use. If you don't have one yet, the steps below set it up.
- **A Cloudflare account on Workers Paid, with a domain on Cloudflare.** The gateway lives at a subdomain of it (for example `apps.your-company.com`) and the CRM one level below (`crm.apps.your-company.com`).
- **Node.js 22.18 or newer**, and **pnpm**.
- **A checkout of the Every App repository** beside this one, at `../private-every-app`, with `pnpm install` run there. The Every App SDK and CLI are not published yet, so the CRM's `package.json` links them from that checkout by path.

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

The CRM has one optional setting of its own. A GitHub token (any classic token with no scopes) raises GitHub's rate limit when the agent matches people to GitHub profiles. Set it after the first deploy:

```bash
pnpm everyapp secret set GITHUB_TOKEN
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

Gmail's read scope is one Google restricts. If everyone who connects is in your own Google Workspace, make the consent screen _Internal_ and no review is needed. An _External_ consent screen needs Google's verification and a yearly security assessment before people outside your Workspace can connect Gmail. Microsoft client secrets expire (after 6 to 24 months): set a new one with the same command before it does.

### Slack

Team agents post to Slack through a Slack app whose client the gateway holds. At [api.slack.com/apps](https://api.slack.com/apps), create an app, add the redirect URL `https://<crm host>/integrations/slack/callback` under _OAuth & Permissions_, and add the bot token scopes `users:read`, `users:read.email`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, `chat:write`, `chat:write.public`, `im:write`, `channels:join`, `channels:manage`, `groups:write`, `channels:write.invites`, `groups:write.invites`, `conversations.connect:write` and `links:write`, and the user token scopes `channels:read`, `channels:write`, `groups:read` and `groups:write`. Then give the gateway its client:

```bash
pnpm everyapp secret set SLACK_CLIENT_ID SLACK_CLIENT_SECRET --for gateway
```

An owner or admin then connects the workspace's Slack from Settings → Connections.

## What works without keys

The CRM works as a CRM with no keys at all: companies, contacts, deals, tasks, notes, CSV import and export, custom fields, saved views, website tracking (Settings → Tracking & Analytics), and the MCP tools AI clients use, at `https://<crm host>/mcp` and on your gateway's `/mcp`. Mail and calendar capture and posting to Slack need the OAuth clients above, and team agents need the model key.

Without a model key, the research agent pauses. Records it would research say "Waiting for setup", and the agent button on Overview says "Agent paused". Settings → General shows which key is missing and, on your own gateway, the command that sets it; owners and admins also see it as a step in Overview's Get started card. Nothing is lost while it waits: the agent does the work once the key is set.

With a model key but no Context.dev key, the agent still researches. Each company shows its website's favicon as its logo, and brand data stays empty.

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

`https://<crm host>/health` answers `200 {"status":"ok","database":"up"}` without signing in, or `503` when the database doesn't answer. Point an uptime monitor at it.

`https://<crm host>/health/dispatch` reports the research agent's queue: when each part last ran, its backlog and recent failures. It answers `503` when a part has stopped or work is overdue. Call it with a personal access token for the CRM, made by an owner or admin on the gateway, in an `Authorization: Bearer` header.

## Upgrading

1. Pull the latest CRM, and update the Every App checkout too. Run `pnpm install` in both.
2. If the Every App checkout changed, run `pnpm everyapp setup` to upgrade the gateway. It keeps the gateway's data, users and apps.
3. Run `pnpm deploy:everyapp` from the CRM checkout.

The deploy migrates the CRM's database after taking a restore point (a D1 Time Travel bookmark, which it prints), then uploads the new version.

## Troubleshooting

**The agent says "Waiting for setup".** The gateway has no model key. Set `OPENROUTER_API_KEY` on the gateway (see [Give the agent its keys](#give-the-agent-its-keys)); the CRM picks it up within about ten minutes. Settings → General shows Connected after the agent's next successful call.

**Settings → General says "Not checked yet".** The gateway is connected, and the agent finds out whether it holds a model key the first time it runs. It runs within a minute of new work being queued, for example when you add a company.

**No logos.** Logos and brand data come from Context.dev, and without it only a company's favicon. Set `CONTEXT_API_KEY` on the gateway.

**Can't sign in, or the app isn't found.** Run `pnpm everyapp status`. It shows the gateway's address and release, its owner, the apps it lists and whether it binds them, each address's certificate, any deploy in progress, and the command to run when something is off.
