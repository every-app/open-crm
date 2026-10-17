# The research agent

The CRM keeps its records up to date with a research agent ported from the CRM's agent (which ran on Vercel). Here it is a [Think](https://developers.cloudflare.com/agents/) agent in a Durable Object (`CrmAgent`, `src/server/features/agent/CrmAgent.ts`), driven by a queue in the database and the Worker's minute cron. Every model and Context.dev call goes through the Every App gateway, named for the organization it is for (`docs/maintainers/every-app.md`).

## The queue

`agent_task` says what the work is: a kind (`src/shared/agent-tasks.ts`), a subject (a company, contact, deal or the workspace), a reason, a priority and when it is due. A partial unique index allows one open task per organization, kind and subject, so queueing the same work twice is a no-op (`AgentTaskRepository.insertIfAbsent`). Anything that recurs ("check again in 30 days") is a task's `due_at`, never a timer.

Work is queued by the features that cause it, through `AgentTaskService`: a new company or contact, a changed workspace website, a new or backfilled custom field the agent fills, a person asking for a recheck.

## The dispatcher

The minute cron (`src/server/cron.ts` → `scheduled.ts`) closes stale tasks, then drains two lanes across every organization (`dispatch.ts`, numbers in `dispatch/config.ts`):

- **Visible** (`brand`, `portrait`): no model. Logos, brand data and photos from Context.dev, copied to R2 (`src/server/lib/images.ts`). Many at once on a short lease. A person adding a company pokes this lane for their organization straight away (`poke.ts`), so the logo appears without waiting for the minute.
- **Research** (everything else): one `CrmAgent` session per task, on a lease long enough to finish and report back. A failed task is retried when its lease runs out, up to a limit, then retired.

Each session has a research budget (`runtime/budget.ts`): every billable lookup costs 2 units, and running out ends the session with a write-up, not an error. On a first-party deployment, `FIRST_PARTY_SCHEDULED_RESEARCH=off` holds the research lane to work a person asked for (`src/server/lib/deployment-tier.ts`). Without a model key on the gateway, research tasks end with a clear outcome instead of retrying.

Beside the lanes, the cron fills contact fields that went blank from the agent's waiting suggestions (`lib/blankFacts.ts`).

## The evidence ledger

What the agent learns about a person is a fact in `contact_fact`, priced by its evidence (`lib/evidence.ts`, `lib/facts.ts`, whose header states the rules). A blank field is filled; a value already there is replaced only by verified evidence; anything weaker becomes a suggestion a person accepts or dismisses on the contact sheet. The agent owns a column only while it still holds the value the agent wrote, so a person's correction is never overwritten. A dismissed value is never offered again.

## Chats

The Agent tab on every record talks to its own `CrmAgent` session over `/agents/crm-agent/<session>`. Session names are minted by the server (`sessionName.ts`) and carry the organization; `agentRoutes.ts` checks every connect and read against the caller's organization and their own conversation, and research sessions are never reachable from a client. Sockets close after 15 minutes and the client reconnects.

The Worker passes the caller's gateway role to the session for the tools only an owner or admin may use (managing custom fields). Two tools pause for approval in a chat (`record_job_change`, `archive_field`): the Agent tab renders the request and answers it with `addToolApprovalResponse`; a pending request survives a reload. `ask_question` is a client tool: the agent asks a person to choose between candidates, and the answer resumes the turn.

## Changing it

- A new tool family is a `ToolGroup` in `tools/registry.ts`; tools run as the session's organization, with their output capped and failures handed back to the model.
- Prompts are in `prompt/`, and the agent's longer guidance in `skills/*.md`.
- Tests stub every vendor call; nothing in the suite spends money.
