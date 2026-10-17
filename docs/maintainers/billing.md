# Billing

The hosted CRM bills each organization's usage exactly as OpenSEO bills it, on the same Autumn account (`src/server/billing`). A fork never bills: its operator's own keys pay the providers.

**One balance with OpenSEO.** The Autumn customer is the gateway organization id (the acting person's email goes on a new customer), and the plans, features and credit math are OpenSEO's, copied verbatim into `src/shared/billing.ts`: monthly `usage_credits` first, then `topup_credits`, 1,000 credits to the dollar, provider cost × 1.28. So an organization's credits are one balance across OpenSEO, the CRM and, later, the gateway. Every charge carries `properties`: `app: "open-crm"`, `provider`, `operation`, `creditFeature` (`crm_agent` for model spend, Sonar searches and compaction summaries; `company_data` for Context.dev), and the session or task it was for.

**Who bills.** The first-party tier (`src/server/lib/deployment-tier.ts`), OpenSEO's `AUTH_MODE=hosted`, outside local dev: `billingEnabledFor` in `src/server/billing/hosted.ts`. `everyapp dev` pins no organization, so a local run derives first party too, and bills only with `BILLING=on` in `.dev.vars`. Billing fails closed: with no Autumn key, or no balance reading, paid work doesn't start.

**The secret, and the gateway rule it breaks.** `everyapp secret set AUTUMN_SECRET_KEY` on the first-party deployment, with the same key OpenSEO uses. The CRM's other credentials live in the gateway; this one doesn't, on purpose, because the gateway can't bill for its apps yet (no cost reading, no wallet, no Autumn). When the gateway's wallet ships, delete `src/server/billing`, its call sites and `workspace.credits_depleted_at`, and let the gateway bill.

**Before paid work starts** (`src/server/billing/credits.ts`). Any positive monthly plus top-up balance admits the work; only a ≤ 0 that Autumn's customer object confirms refuses it (OpenSEO's `checkUsageCreditsDepleted`).

- A person's chat or builder turn: `SessionMeter.admit` in `CrmAgent.beforeTurn`. Out of credits, the turn answers with a static reply and costs nothing.
- Enrich now and bulk enrich, in the app, the MCP tools and the REST API: `CompanyService`, `ContactService`. Refused with `INSUFFICIENT_CREDITS` (HTTP 402).
- Run now and Retry: `AgentRunService`. Refused with `INSUFFICIENT_CREDITS`. A schedule's or an event's run is skipped and audited (`run.skipped`), as the daily cap skips it, and the dispatcher fails a queued run it can't pay for (`team-agents/runtime/dispatch.ts`).
- The minute cron's research and logo lookups (`agent/dispatch.ts`, `scheduled.ts`, the pokes): an out-of-credits organization's tasks go back to the queue, their attempts uncounted. Autumn's confirmed "out" is kept on the workspace row (`creditReading.ts`) and holds the organization for five minutes without asking Autumn again; a positive reading is never kept, so every start asks. Reading the Billing page with credits lifts the hold at once. The queue and a record's agent tab say the agent waits for credits.

**After it ran.** Nothing is reserved: spend is billed after the fact.

- A session's model steps, compaction summaries and Sonar searches (`meter.ts`): added to the session's running total and billed in $0.05 chunks on one serialized chain, the rest when the turn ends (`onChatResponse`, `onChatError`, kept alive with `waitUntil`). Chats bill without overdraft (Autumn stops at zero); research sessions and team agent runs bill with OpenSEO's background overdraft and never throw (`researchSpend.ts`).
- Sonar and Context.dev report each call from inside the tool that made it (`spendSink.ts`): the agent's tools run inside their session's sink (`tools/registry.ts`), the cron's lookups inside the lane's.
- Context.dev: what it reports in `key_metadata.credits_consumed`, at $0.0025 a credit, else its list price (`contextDevPricing.ts`), as `company_data`, with overdraft.

**Settings → Billing** (hosted only): the plan with OpenSEO's Upgrade (Autumn checkout) and Manage subscription (Stripe's portal), monthly and top-up credits, Buy credits for $10–$99, and the last 30 days' usage by feature. Only the owner acts (`billing: ["manage"]`). The low and out-of-credits banner is OpenSEO's. Every refusal for credits opens one dialog with OpenSEO's offer (`OutOfCreditsDialog.tsx`), dismissed each time: a refused action through the mutation cache (`INSUFFICIENT_CREDITS`), and a chat turn when its refusal reply arrives in the open chat.

**OpenSEO's billing page** names usage by `creditFeature` and shows a key it doesn't know as "Other". It needs `crm_agent` ("CRM Agent") and `company_data` ("Company Data") in `CREDIT_FEATURE_LABELS` (`src/shared/billing-credit-features.ts`) to name the CRM's usage.

## Run it locally

```bash
# .dev.vars
BILLING=on
AUTUMN_DEV_STUB=free   # or paid, low, out
```

`AUTUMN_DEV_STUB` stands in for Autumn (`autumnDevStub.ts`), and only under `everyapp dev`: the organization in one fixed state, nothing charged, checkout coming straight back. Without it, `BILLING=on` calls Autumn with `AUTUMN_SECRET_KEY`; use a sandbox key.
