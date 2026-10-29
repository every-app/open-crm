# Self-hosting OpenCRM

OpenCRM runs behind an Every App gateway, in your own Cloudflare account. This page covers installing it on your gateway, its settings, local runs, operations, upgrades and troubleshooting.

## What you need

- **An Every App gateway.** The gateway is a Worker in your Cloudflare account that signs people in, decides who may open each app, and holds the provider keys apps use. If you don't have one yet, [Every App's docs](https://everyapp.com/docs) set it up: `pnpm everyapp setup` from a checkout of [every-app/every-app](https://github.com/every-app/every-app).
- **A Cloudflare account on Workers Paid, with a domain on Cloudflare.** The gateway lives at a subdomain of it (for example `apps.your-company.com`) and the CRM one level below (`crm.apps.your-company.com`).
- **R2 enabled** on the account, once, before the install (Cloudflare dashboard → R2 Object Storage → Get started). The CRM keeps logos and photos in an R2 bucket; without R2 the install stops with `R2_NOT_ENABLED`.
- **Node.js 22.18 or newer**, and **pnpm 10**, for the Every App checkout. The CRM itself needs no checkout: the Every App SDK and CLI it builds with are the published packages `@every-app/sdk` and `everyapp`, pinned to one exact version in `package.json`.

## Install it

From your Every App checkout:

```bash
pnpm everyapp install https://github.com/every-app/open-crm
pnpm everyapp configure crm
```

The install registers the CRM with the gateway, creates its D1 database and R2 bucket, migrates the database, uploads the latest release and binds it to the gateway. `configure` then asks for the CRM's optional settings; it does the `secret set` commands on this page for you. When both are done, the CRM appears on your gateway for every member of your organization. Run the install command again later to update; your data stays.

To deploy a fork with your own changes instead, clone it next to your Every App checkout, run `pnpm install` in it, and from its directory run the checkout's CLI: `node ../every-app/packages/cli/bin/everyapp.js deploy`. A deploy also updates the gateway, which only a checkout can build.

The CRM has two optional settings of its own, which the [Settings table](maintainers/every-app.md#settings) lists with the gateway's: `TOKEN_ENCRYPTION_KEY` and `ERASURE_SECRET` ([Erasing an organization](#erasing-an-organization)). `pnpm everyapp configure crm` asks for each; any one can also be set alone with `pnpm everyapp secret set <NAME> --app crm`, from any directory. The CRM opens without them.

Before anyone connects mail or a calendar, give the CRM `TOKEN_ENCRYPTION_KEY`, the key it encrypts their tokens with: 32 or more random characters, for example `openssl rand -base64 32`. `pnpm everyapp configure crm` asks for it. Until it is set, each page under Settings → Connections says so. Keep it safe: if it changes or is lost, everyone connects again.

## Mail and calendar

Members connect their own Gmail and Google Calendar, or Outlook, from Settings → Connections, and the CRM files their work conversations and meetings on companies and contacts. It only reads: it never sends, changes or drafts mail. The OAuth clients live on the gateway, so set up whichever you want people to use:

1. **Google.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), enable the Gmail API and the Google Calendar API, create an OAuth client of type _Web application_, and add the redirect URI `https://<crm host>/integrations/google/callback` (for example `https://crm.apps.your-company.com/integrations/google/callback`). On the consent screen, add the scopes `gmail.readonly` and `calendar.readonly`.
2. **Microsoft.** In [Microsoft Entra](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade), register an application for _accounts in any organizational directory and personal Microsoft accounts_, add the _Web_ redirect URI `https://<crm host>/integrations/microsoft/callback`, add the delegated Microsoft Graph permissions `User.Read`, `Mail.Read` and `offline_access`, and create a client secret.
3. Give the gateway each client:

```bash
pnpm everyapp secret set GOOGLE_WORKSPACE_CLIENT_ID GOOGLE_WORKSPACE_CLIENT_SECRET
pnpm everyapp secret set MICROSOFT_365_CLIENT_ID MICROSOFT_365_CLIENT_SECRET
```

Settings → Connections shows the exact redirect URI for your CRM to owners and admins, and each card says when its client isn't set up yet. The redirect URI is on the CRM's host: the CRM runs the consent flow itself and the gateway only completes the token exchange with its client, so this is not the `https://<gateway>/connect/<provider>/callback` address the gateway's own **Add OAuth provider** dialog shows for providers it connects on apps' behalf.

Gmail's read scope is one Google restricts. If everyone who connects is in your own Google Workspace, make the consent screen _Internal_ and no review is needed. An _External_ consent screen needs Google's verification and a yearly security assessment before people outside your Workspace can connect Gmail. Left in _Testing_, it takes at most 100 test users, and their connections stop working after 7 days.

Microsoft client secrets expire after the period you pick when you create one, from 90 days to 24 months. Set a new one with the same command before it does.

Organizations that let only admins consent send members to an approval page. An admin opens the **Grant admin consent** link on the member's Microsoft page in the CRM, or in Microsoft Entra goes to _Enterprise applications_, the app, _Permissions_, **Grant admin consent**.

## Invite your team

Everyone in your organization on the gateway can open the CRM. Owners and admins invite people on the gateway, under Users → Invite user (`https://<gateway>/admin/users`). If the gateway can't send email, copy the invite link it shows and send it yourself. Settings → Workspace → Members links to that access management page.

To remove someone, remove them on the gateway, then disconnect their mailbox under Settings → Connections → Members' mailboxes. Otherwise their mail and calendar keep syncing until 30 days after the CRM last saw them.

Owners can export all of the workspace's data from Settings → Workspace.

## What works without OAuth clients

The CRM works as a CRM with no keys at all: companies, contacts, deals, tasks, notes, CSV import and export, custom fields, saved views, website tracking, and the MCP tools AI clients use. Clients that sign in with OAuth, such as claude.ai and ChatGPT, connect to your gateway's `/mcp`; the CRM's own `https://<crm host>/mcp` takes only a personal access token. Mail and calendar capture need the OAuth clients above.

## Website tracking

The tracking tag runs on your own website, for visitors who aren't signed in:

- If your site sends a Content-Security-Policy, allow the CRM's host (`https://<crm host>`) in `script-src` and `connect-src`.
- If Cloudflare Access protects your gateway (`pnpm everyapp access on`), there is nothing to add by hand: `access on`, and every deploy after it, lets the routes the CRM's manifest marks `public` (`/t/*` and `/t/e`) through without a login.
- The collector takes at most 600 events a minute from a site and 120 from one visitor, 120 requests a minute from one address to one site (600 across sites), and 50,000 events a day per organization. Forms create at most 50 contacts an hour. Anything over is dropped.
- Add `data-crm-ignore` to a form or a field to keep it out of tracking. Forms with a password field are never sent.

## Run it locally

```bash
pnpm install
pnpm dev
```

This starts the CRM behind a local gateway at http://crm.localhost:8787, signed in as a seeded dev owner. The first visit asks for a workspace name and website. Use `pnpm dev --port 8840` to pick another port.

The CRM's own settings for local runs go in a `.dev.vars` file in this checkout (copy `.dev.vars.example`). All are optional.

## Health checks

For uptime, point a monitor at your gateway's own `https://<gateway host>/health`, checking every minute: it is public, needs no token, and Cloudflare Access lets it through.

`https://<crm host>/health` answers `200 {"status":"ok","database":"up"}`, or `503` when the CRM's database doesn't answer. It is private like the rest of the CRM: call it with a personal access token for the CRM in an `Authorization: Bearer` header. Tokens expire (after 7 to 180 days, or on a date you pick), and the monitor fails from then on: make a new one before it does. A token is its member, for everything the CRM lets them do, so keep it in the monitor's secret store. If Cloudflare Access protects your gateway, the CRM's host asks the monitor to log in too; an Access service token is what gets a non-browser client past that (the Every App docs on Cloudflare Access cover it), and the gateway's `/health` needs none.

## Operations

### Backups

D1 keeps every change for 30 days (Time Travel), with nothing to set up. Each deploy also takes a restore point before it migrates, and prints the command that goes back to it.

For a copy outside Cloudflare, export the database with Wrangler, Cloudflare's other CLI, which asks you to log in the first time. The CRM's database is named like its Worker, `every-<org key>-crm` (`pnpm exec cf d1 list` shows it). An export blocks the database's other requests while it runs, so make it when nobody is working:

```bash
npx wrangler d1 export every-<org key>-crm --remote --output crm-backup.sql
```

The export is SQL, which `npx wrangler d1 execute <database> --remote --file crm-backup.sql` loads into an empty database.

Neither covers the logos and photos in the CRM's R2 bucket. They aren't backed up.

### Restoring

To take the database back to a moment in the last 30 days, or to a deploy's restore point:

```bash
pnpm exec cf d1 time-travel restore <database id> --timestamp 2026-10-19T09:00:00Z
pnpm exec cf d1 time-travel restore <database id> --bookmark <bookmark the deploy printed>
```

A restore rewinds the whole database in place, so everything written since is lost. It prints a bookmark that undoes it. Images aren't rewound.

### Rolling back

To serve the previous version again, open the CRM's Worker in the Cloudflare dashboard (Workers & Pages → `every-<org key>-crm` → Deployments) and choose Rollback beside that version. A rollback leaves the database as it is: the older version runs on the migrated database, because migrations only add tables and columns. To undo a migration's changes to data too, restore the deploy's bookmark.

After a rollback, the CRM serves a version `everyapp` didn't upload, so the next install or deploy asks before replacing it. Run that deploy in a terminal: where it can't ask, as in CI, it stops without changing anything.

### Logs

Every deploy turns on Workers Logs and traces. Open them under Workers & Pages → `every-<org key>-crm` → Observability. Workers Paid keeps logs for 7 days, and Workers Issues groups the errors.

### Erasing an organization

To erase an organization and everything it stored, follow `docs/maintainers/runbooks/erase-organization.md`. It needs `ERASURE_SECRET`, set with `pnpm everyapp secret set ERASURE_SECRET --app crm` for the erasure and removed afterwards.

### Operator scripts

From this checkout, with your Cloudflare login, these read the deployed CRM's database and print JSON:

```bash
pnpm ops organization <organization id or member email>   # records, members and connections
```

## Upgrading

Releases are tagged (`v0.1.0`), and the [release notes](release-notes.md) list each one's breaking changes, new settings, migrations and the Every App release it needs.

1. Run `pnpm everyapp install https://github.com/every-app/open-crm` again from your Every App checkout. It takes a restore point (a D1 Time Travel bookmark, which it prints), migrates the CRM's database, then uploads the new version. Your data stays.
2. Set any new settings the notes list: `pnpm everyapp configure crm` asks for the ones still missing.
3. If the notes name a newer Every App release, `git pull` and `pnpm install` in the Every App checkout, then `pnpm everyapp update` upgrades the gateway. It keeps the gateway's data, users and apps.

A fork merges the release's tag and deploys with the checkout's CLI, as under [Install it](#install-it).

If your fork changes the schema, change tables only by adding to them. On D1, a migration that rebuilds a table deletes the rows of every table that references it, and `pnpm test` refuses one.

## Troubleshooting

**Can't sign in, or the app isn't found.** Run `pnpm everyapp status`. It shows the gateway's address and release, its owner, the apps it lists and whether it binds them, each address's certificate, any deploy in progress, and the command to run when something is off.
