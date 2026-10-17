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

Each command asks for the value at a hidden prompt, so the key never appears in your shell history. The change is live on the gateway at once, with no redeploy of the gateway or the CRM. The CRM notices a newly set model key on its own: work waiting for it starts within about ten minutes, with no restart.

### Mail and calendar

<!-- TODO(maintainer): Google Workspace and Microsoft 365 OAuth client setup for mail and calendar capture. -->

Mail and calendar capture use Google Workspace and Microsoft 365 OAuth clients that the gateway holds. Setup steps are coming.

## What works without keys

The CRM works as a CRM with no keys at all: companies, contacts, deals, tasks, notes, CSV import and export, custom fields, and saved views.

Without a model key, the research agent pauses. Records it would research say "Waiting for setup", the agent button on Home says "Agent paused", and the setup checklist (on Home for owners and admins, and in Settings → Setup) shows what is missing and, on your own gateway, the command that sets it. Nothing is lost while it waits: the agent does the work once the key is set.

With a model key but no Context.dev key, the agent still researches. Logos and brand data stay empty.

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

## Upgrading

1. Pull the latest CRM, and update the Every App checkout too. Run `pnpm install` in both.
2. If the Every App checkout changed, run `pnpm everyapp setup` to upgrade the gateway. It keeps the gateway's data, users and apps.
3. Run `pnpm deploy:everyapp` from the CRM checkout.

The deploy migrates the CRM's database after taking a restore point (a D1 Time Travel bookmark, which it prints), then uploads the new version.

## Troubleshooting

**The agent says "Waiting for setup".** The gateway has no model key. Set `OPENROUTER_API_KEY` on the gateway (see [Give the agent its keys](#give-the-agent-its-keys)); the CRM picks it up within about ten minutes. Settings → Setup shows Ready after the agent's next successful call.

**Settings → Setup says "Not checked yet".** The gateway is connected, and the agent finds out whether it holds a model key the first time it runs. It runs within a minute of new work being queued, for example when you add a company.

**No logos.** Logos and brand data come from Context.dev. Set `CONTEXT_API_KEY` on the gateway.

**Can't sign in, or the app isn't found.** Run `pnpm everyapp status`. It shows the gateway's address and release, its owner, the apps it lists and whether it binds them, each address's certificate, any deploy in progress, and the command to run when something is off.
