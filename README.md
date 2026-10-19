# OpenCRM

An open-source CRM kept up to date by a research agent, running on an
[Every App](https://everyapp.com) gateway. Ported from
[Comp AI's CRM](https://github.com/trycompai/crm) (v1.15.3, commit `6d4793d`)
onto Cloudflare Workers.

The gateway signs people in, decides who may open the CRM, serves the CRM's
tools to AI clients on its one MCP connector, and holds the model and
Context.dev keys, so the CRM itself needs no settings.

## Run it locally

With Node.js 22.18+, pnpm 10, and the Every App repository checked out beside
this one (`../private-every-app`, with `pnpm install` run there):

```bash
pnpm install
pnpm dev        # http://crm.localhost:8787, signed in as a dev owner
```

## Deploy it

To your own Every App gateway: `pnpm deploy:everyapp`, then set the agent's
keys on the gateway. [docs/self-hosting.md](docs/self-hosting.md) covers
setup, keys, costs, local runs, operations, upgrades and troubleshooting, and
[docs/release-notes.md](docs/release-notes.md) what each release changes.
