# OpenCRM

An open-source CRM kept up to date by a research agent, running on an
[Every App](https://everyapp.com) gateway. Ported from
[Comp AI's CRM](https://github.com/trycompai/crm) (v1.15.3, commit `6d4793d`)
onto Cloudflare Workers.

The gateway signs people in, decides who may open the CRM, serves the CRM's
tools to AI clients on its one MCP connector, and holds the provider keys: the
model (OpenRouter) and Context.dev keys and the Google, Microsoft and Slack
OAuth clients. The CRM has a few settings of its own, all optional until a
feature needs them; `pnpm everyapp secret list` in this directory shows each
one and whether it is set, and the
[Settings table](docs/maintainers/every-app.md#settings) says what each unlocks
and the command that sets it.

## Run it locally

With Node.js 22.18+ and pnpm 10. The CRM's `package.json` links the Every App
SDK and CLI by path from a checkout of
[every-app/private-every-app](https://github.com/every-app/private-every-app)
beside this repository, in the same parent directory (`../private-every-app`):
clone it there and run `pnpm install` in it once (it builds the SDK) before
`pnpm install` here. A lone clone installs with dangling links, and `pnpm dev`
fails with `everyapp: command not found`.

```bash
git clone git@github.com:every-app/private-every-app.git ../private-every-app
pnpm -C ../private-every-app install   # once; builds the SDK
pnpm install
pnpm dev        # http://crm.localhost:8787, signed in as a dev owner
```

No gateway holds the agent's keys locally: copy `.dev.vars.example` to
`.dev.vars` and fill in your own OpenRouter and Context.dev keys. `pnpm dev`
names any that are missing, and runs without them (the agent then shows as not
set up).

## Deploy it

To your own Every App gateway: `pnpm deploy:everyapp`, then set the agent's
keys on the gateway. Before anyone connects mail, a calendar or Slack, give the
CRM `TOKEN_ENCRYPTION_KEY`, the key their tokens are encrypted under:

```bash
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" pnpm everyapp secret set TOKEN_ENCRYPTION_KEY --from-env TOKEN_ENCRYPTION_KEY
```

[docs/self-hosting.md](docs/self-hosting.md) covers setup, keys, costs, local
runs, operations, upgrades and troubleshooting, and
[docs/release-notes.md](docs/release-notes.md) what each release changes.
