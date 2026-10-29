# Developing OpenCRM

OpenCRM runs on an [Every App](https://everyapp.com) gateway. The gateway signs people in, decides who may open the CRM, serves the CRM's tools to AI clients on its one MCP connector, and holds the Google and Microsoft OAuth clients for mail and calendar capture. The CRM has a few settings of its own, all optional until a feature needs them; `pnpm everyapp secret list` in this directory shows each one and whether it is set, and the [Settings table](maintainers/every-app.md#settings) says what each unlocks and the command that sets it.

It is ported from [Comp AI's CRM](https://github.com/trycompai/crm) (v1.15.3, commit `6d4793d`) onto Cloudflare Workers.

## Run it locally

With Node.js 22.18+ and pnpm 10. The Every App SDK and CLI it builds with are the published packages `@every-app/sdk` and `everyapp`, pinned to one exact version in `package.json`, so a clone of this repository installs and builds on its own: no checkout of the Every App repository beside it.

```bash
pnpm install
pnpm dev        # http://crm.localhost:8787, signed in as a dev owner
```

The CRM's own settings for local runs go in `.dev.vars` (copy `.dev.vars.example`). All are optional: `pnpm dev` runs without them.

## Deploy your own changes

`pnpm everyapp install https://github.com/every-app/open-crm` installs the latest release, which the Release workflow publishes on every push to the default branch; run it again later to update. `pnpm everyapp configure crm` asks for the CRM's optional settings, `TOKEN_ENCRYPTION_KEY` among them: set it before anyone connects mail or a calendar, since their tokens are encrypted under it. Any one setting can also be set on its own with `pnpm everyapp secret set <NAME>`.

To deploy your own changes instead, run your Every App checkout's CLI from this directory: `node ../every-app/packages/cli/bin/everyapp.js deploy` (the CLI installed here runs `dev`, `db migrate` and `release`; a deploy also updates the Gateway, which only a checkout can build).

[self-hosting.md](self-hosting.md) covers setup, keys, costs, local runs, operations, upgrades and troubleshooting, and [release-notes.md](release-notes.md) what each release changes.
