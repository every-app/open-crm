# TODO

What is left open for OpenCRM, by the pass that found it; each bullet says what, why, and (in parentheses) whose it is when it isn't this app's.

## Lists and deals opt-in (2026-10-31)

Decided for Ben: built from docs/design/contact-lists.md on Ben's go-ahead, taking the recommended answer to each of its questions. Revisit any of them by reopening this section.

- [x] **Lists double as tags; no separate tag system.** A list without stages is a group: chips on the record, a sidebar count, a filter.
- [x] **A list holds people or companies, chosen per list.** Backlink targets are publications, networking is people.
- [x] **Every list is shared with the whole team.** No private lists; add them only if asked.
- [x] **Status is per list (its stages), not one global status.** Someone can be "Backlink outreach: Replied" and "Networking: Met" at once.
- [x] **Names: List, Stage, Timeline; "Deals" keeps its name** for teams that sell.
- [x] **Deals are opt-in: off for a new workspace, on where the organization already had deals** (the 0001_lists migration's backfill). Turning them off hides deals; nothing is deleted.
- [x] **Sidebar: Contacts, Companies, Overview, Deals (when on), then Lists with counts.** The Directory tabs are gone.
- [x] **The LinkedIn import adds to no list by default.** Connections run into the thousands; one choice picks a list and starting stage. (Applies once `feat/linkedin-import` merges; the CSV import already ends with the list step.)
- [x] **Follow-up (Due) is in the first version, as one number of days per list.**
- [x] **With deals off, the Overview shows each list's stage counts and Due, with overdue tasks and recent activity.**

## First run (2026-10-24)

- [ ] **get_mailbox_status carries the reason and the setting.** It answers `available: false` with no reason, no setting and no who. `ConnectionService.status` already has the gateway's own words (`setup`, `settings`, `command` from `integrationStatus`), so each unavailable entry can pass them on. (crm-27)
- [ ] **Phone: the success toast covers the focused quick-add field.** Right after "Add company" on a phone the toast "Acme Co added." sits over the deal form's Name field (mobileOffset 100 px, the form is at the bottom of the sheet). Use `useIsMobile()` to put toasts at top-center on phones, or scroll the quick-add form clear. (crm-17)
- [x] **/settings/tracking is linked from Settings again.** PR #3 had removed Tracking from the settings nav while the full page stayed served. The page is the only place to rotate the site id and verify an install, which the MCP tools leave to people, so it is back in the nav as "Tracking". (crm-20)
- [ ] **A Help link in the sidebar foot.** No docs link anywhere; "Back to Every App" is the only outbound link, and `docs/` in this repo is for maintainers. Decide where per-app user docs live (the onboarding audit's per-app docs PRs are pending) and whether the foot links there or to everyapp.com/docs/connect-ai. (crm-22, a decision for Ben)
- [ ] **AUTH_CONFIG_MISSING copy: "Deploy it with `everyapp deploy`" shown to a member.** The sentence is built in `src/middleware/ensure-user/everyApp.ts` (the identity-header middleware) and mapped in error-messages.ts; only reachable when the Worker runs without the Every App binding, so low priority, but the fix touches identity handling. (crm-15, held for Ben)

## Agents removed (2026-10-29)

- [ ] **Drop the retired mail token columns a release after the move to the gateway.** Mail goes through the Every App gateway's connections since migration `0002_mail_through_gateway`, which emptied `access_token`, `access_token_expires_at` and `refresh_token` on `mailbox_connection` and every `oauth_state` row. Nothing reads them. Drop them with a migration marked `-- everyapp:contract <release>` (`ALTER TABLE … DROP COLUMN`; `oauth_state` needs `release-migrations.test.ts` to allow a marked `DROP TABLE` with nothing cascading from it), then remove them from `src/db/crm.schema.ts`. Also unset `TOKEN_ENCRYPTION_KEY` on each deployment (`pnpm everyapp secret unset TOKEN_ENCRYPTION_KEY --app crm`).
- [ ] **Microsoft admin consent through the gateway.** The CRM's own flow linked Microsoft's admin consent for a member whose organization lets only admins consent; the gateway's flow ends on its error page. Until the gateway offers it, an admin grants consent to the gateway's client in Microsoft Entra.
- [ ] **Drop the retired agent tables a release after the removal.** The research agent, team agents and Slack are gone, but their tables stay so the release that removed them only expands the schema: `agent_task`, `dispatcher_lane`, `agent_event`, `agent_conversation` (`src/db/agent.schema.ts`); `agent_definition`, `agent_version`, `agent_builder_artifact`, `agent_trigger`, `agent_run`, `agent_action`, `agent_audit_event`, `agent_conversation_feedback`, `agent_conversation_attachment` (`team-agent.schema.ts`); `agent_conversation_share` (`sharing.schema.ts`); `slack_connection`, `slack_channel`, `slack_member_match`, `slack_oauth_state` (`slack.schema.ts`); and the agent's columns and tables in `crm.schema.ts` (`company_enrichment`, `contact_fact`, `contact_brief`; `enrichment_status`, `enriched_at`, `enrichment_error` and `research_held_at` on `company` and `contact`; `model_refused_at`, `model_refusal`, `model_answered_at`, `enrichment_swept_at` and `research_automatically` on `workspace`; `agent_filled` and `agent_brief` on `field_definition`). Drop them with a migration marked `-- everyapp:contract <release>`, then remove the schema files, the archive purge's and the erasure's deletes of `agent_task`, `agent_event` and `agent_action`, and those rows from `HEAVY` in `ErasureRepository`.
- [ ] **Deploy each existing install with `--allow-delete-durable-object-data`.** The manifest no longer declares `CrmAgent`, so `everyapp deploy` (and `everyapp install` of this release) refuses with `DURABLE_OBJECT_REMOVED` until the flag says to delete its data (agent chats and research transcripts). A fresh install needs nothing.
- [ ] **Decide on R2.** Nothing writes to the bucket any more; it only serves the logos and photos the agent copied (`src/server/lib/images.ts`). A fresh install still needs R2 for it. Either keep it as the CRM's image store, or drop the binding, `serveImage` and the image URLs on records together.

## Cold open (2026-10-24)

Measured by the app-open-latency swath from Workers Logs (48 h, SJC) and handed to the clarity pass, which took none of it: these are shell and bundle changes, not clarity. The platform side (prefetch on hover, fingerprinted assets cached a year, `Server-Timing: gw;dur, app;dur`) is in private-every-app #572 and #573.

- [ ] **The cold start.** A trivial `GET /health` (public when measured; private since #8) spends 350–1200 ms inside the Worker on a cold isolate (14 samples), a few ms warm; the document `/` took 421 ms in the Worker on Ben's click. Measured on a production build (2026-10-24), the Worker's entry chunk was 5.8 MB, about 3.5 MB of it the agent stack (`agents`, `ai`, `@cloudflare/think`, the MCP client). With the agents removed (2026-10-29) the entry chunk is 1.9 MB, with a 2.1 MB router chunk statically behind it; measure the cold start again before doing more. Target: `/health` under 100 ms cold. (crm-40)
- [ ] **Two sequential server functions before any content.** The page is a ClientOnly shell (`src/routes/__root.tsx`): the HTML paints nothing, ~6 script chunks load, then `getWorkspace` (`src/routes/_app/route.tsx`, 480 ms on its first call: `resolveEveryAppContext` runs `ensureUserRecord` and `ensureEveryAppMembership`), then the dashboard summary (`ssr: false` loader on `src/routes/_app/index.tsx`). Either preload the first server function from the document (an inline `<link rel="preload">`/early fetch), or answer workspace and summary in one hop, or server-render the shell. Warm server functions are 30–80 ms in the Worker. (crm-41)
- [ ] **Images on the dashboard.** `/api/images/...` R2 reads take 157–235 ms each in the Worker, 5+ per Overview; the response is already `private, max-age=31536000, immutable` with an ETag, so only the first view pays. A Cache API layer in the Worker would cut repeat cold-isolate reads. (crm-42)
