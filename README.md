# Open CRM

An open-source CRM kept up to date by a research agent, running on an
[Every App](https://everyapp.com) gateway. Ported from
[Comp AI's CRM](https://github.com/trycompai/crm) onto Cloudflare Workers.

The gateway signs people in, decides who may open the CRM, serves the CRM's
tools to AI clients on its one MCP connector, and holds the model and
Context.dev keys, so the CRM itself needs no settings.

## Run it locally

You need Node.js 22.18+, pnpm, and a checkout of the Every App repository
beside this one (`../private-every-app`, with `pnpm install` run there), until
the Every App SDK and CLI are published.

```bash
pnpm install
pnpm dev        # everyapp dev → http://crm.localhost:8787, signed in as a dev owner
```

The research agent's model and Context.dev calls go through the gateway. With
no gateway locally, put your own `OPENROUTER_API_KEY` and `CONTEXT_API_KEY` in
`.dev.vars`.

## Deploy it

On your own Every App gateway (D1, one organization):

```bash
pnpm deploy:everyapp
```

As a shared first-party app of a hosted gateway (Postgres through Hyperdrive,
every organization from one Worker), with the database URL in
`.everyapp/secrets.env` (`POSTGRES_DATABASE_URL=...`):

```bash
pnpm deploy:everyapp:first-party
```

See [docs/maintainers/every-app.md](docs/maintainers/every-app.md).
