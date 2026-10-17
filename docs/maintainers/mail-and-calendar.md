# Mail and calendar

Each member connects their own Gmail and Google Calendar, or their Outlook mail, from Settings → Connections. The CRM reads them (never sends, changes or drafts anything) and files their work conversations and meetings on the organization's companies and contacts, adding the records it should. The code is `src/server/features/mailbox`.

## What the operator sets up

The gateway holds the two OAuth clients (`google-workspace`, `microsoft-365` in `everyapp.config.ts` `capabilities`); the CRM holds none. Until an operator sets one, its card on Settings → Connections says it isn't set up (owners and admins of a fork see the command and the redirect URI).

```bash
pnpm everyapp secret set GOOGLE_WORKSPACE_CLIENT_ID GOOGLE_WORKSPACE_CLIENT_SECRET --for gateway
pnpm everyapp secret set MICROSOFT_365_CLIENT_ID MICROSOFT_365_CLIENT_SECRET --for gateway
```

Register these redirect URIs on each client, on the CRM's own host:

- Google: `https://<crm host>/integrations/google/callback`, scopes `gmail.readonly` and `calendar.readonly`.
- Microsoft: `https://<crm host>/integrations/microsoft/callback`, scopes `offline_access User.Read Mail.Read`, registered for accounts in any organization and personal accounts (the gateway completes the `common` endpoint only).

Gmail's read scope is restricted. An **Internal** consent screen (mailboxes in the operator's own Google Workspace) needs no review; an **External** one needs Google's verification and a yearly security assessment before anyone else's mailbox can connect. A member may untick Gmail or Calendar on Google's consent screen: the CRM keeps what was granted and syncs only those sources.

In local dev, put a client of your own in `.dev.vars` under the same names; the SDK calls the token endpoint directly with it.

## How capture works

- **Connect.** `startConnect` builds the authorize URL from the gateway's public `clientId`, with a single-use `state` (an `oauth_state` row bound to the member and organization, ten minutes) and a PKCE S256 challenge whose verifier stays in that row. The callback runs under the member's signed-in session, consumes the state with a conditional update (a replayed, expired or someone else's state is refused), exchanges the code through `integrationFetch` (the gateway adds its client), learns the mailbox's address (Gmail profile, Calendar's primary calendar, or Graph `/me`), stores the member's tokens in `mailbox_connection` and creates a `mailbox_sync` row per granted source.
- **Tokens** are kept the way the CRM's Better Auth `account` row kept them: in the CRM's database, unsealed, because the platform gives apps no sealing key yet. They never reach the client, logs, errors, the agent or MCP tools. Refreshes go through the gateway, background ones naming the organization; the newest refresh token always wins (Microsoft rotates them), and `invalid_grant` marks the connection and its sources NEEDS_RECONNECT.
- **Sync** runs from the minute cron for every organization: one indexed query (`mailbox_sync_next_idx`) for the rows due, longest-waiting first, each claimed with a lease (a conditional update) and checked inside `forOrganization`. Each mailbox is checked every five minutes. A tick shares a budget of provider calls and wall time across its checks; each check stops where it got to (Gmail at a history record, Outlook at a received time) and goes to the back of the line. A failure is recorded on the source and retried at its next turn; a rate limit waits as long as the provider asked. "Check now" runs the member's sources at once under the same lease.
- **Forward only.** Gmail's first check records the mailbox's historyId; Outlook's records the time; neither imports the past. Calendar's first check reads now to 180 days ahead, then only changes (sync token). An expired cursor starts again from now.
- **Filing** (`CaptureService`, `MatchService`): a thread is keyed by the RFC id of its first message, so the same conversation in two members' mailboxes is one thread; a message is stored once per organization. Matching goes contact by address, then the company of the people's dominant work domain, then, only when the source may add records (calendar by default; Gmail and Outlook when the member turns it on, and only once the member has written in the thread; never for a meeting they declined), a new company and contact with `source` EMAIL or CALENDAR and an ENRICHMENT activity. Our members' addresses and domains, suppressed contacts and domains, machine and automated addresses never become people, and free-mail domains never become companies. A contact with no name queues the agent's `identify`; a meeting within a week queues `meeting-prep` for each attendee the agent has no brief on.
- **Delete synced data** removes what one member's mailbox brought in, rebuilds threads other members' mail still holds, and recomputes last activity. **Disconnect** withdraws Google's grant at Google first; Microsoft has no revocation endpoint, so the page sends the member to their Microsoft account.
- **Team agents** read the captured threads and meetings filed on their records only when their deployed version carries the Email or Calendar grant, which the builder offers once some member has connected a mailbox or calendar ([agent.md](agent.md), "Team agents"). They read the rows, never a mailbox or a token.

## Known limits

- A member the gateway removes keeps syncing until their connection is disconnected: the CRM only mirrors membership.
- A calendar change set longer than five pages restarts from its cursor on the next check rather than resuming mid-set, as in the CRM.
