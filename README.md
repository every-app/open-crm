# OpenCRM

> **A CRM that fills itself in.**
>
> Add a company and a research agent finds its website, logo and people. Connect Gmail or Outlook and your conversations and meetings land on the right records.

## Features

- Companies, contacts, deals, tasks and notes, with custom fields and saved views.
- A research agent that profiles new companies and contacts and briefs you before meetings.
- Gmail, Google Calendar and Outlook capture, read only. It never sends or drafts mail.
- Website tracking: visitors and form submissions become contacts.
- CSV import and export.
- Team agents that post to an approved Slack channel.
- MCP tools for Claude Code, Cursor and your other AI clients.

## Install on EveryApp

```bash
pnpm everyapp install https://github.com/every-app/open-crm
pnpm everyapp configure crm
```

Needs a model key (OpenRouter first), a Context.dev key, and R2 enabled on your Cloudflare account. Details: [everyapp.com/docs/apps/crm](https://everyapp.com/docs/apps/crm)

Development: [docs/development.md](docs/development.md). Self-hosting: [docs/self-hosting.md](docs/self-hosting.md).

## Thanks

OpenCRM started as a port of [Comp AI's CRM](https://github.com/trycompai/crm) (MIT). Thanks to the Comp AI team for building it. Their copyright and license are kept in [LICENSE](LICENSE).
