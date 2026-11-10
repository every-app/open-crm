# Lists and relationship status

Status: built (2026-10-31), with the recommended answer to each question below; TODO.md records them as "Decided for Ben". It covers two asks from Ben as one model.

As built: the tables are `record_list`, `list_stage` and `list_entry` (migration `0001_lists`); a list opens in the contacts or companies page as `?list=<id>` (with `stage`, `listDue` and `view=board`); a stage removed from a list must be empty first.

Mocks:

- [recommended](contact-lists/mock-recommended.html): lists with stages, for outreach and networking, with deals off. Open `#networking` or `#networking/Maya Chen` to jump to the networking board and a person sheet. Click any card to open its sheet.
- [alternative](contact-lists/mock-alternative.html): tags plus pinned saved views.

## The asks

> We have all these different kinds of leads: agencies from LinkedIn, YouTuber influencers, and other lists. I'd like them organized as lists I can easily toggle between. Maybe that's separate from tags, although maybe it should just be tags.

> Rethink Deals from first principles. Outreach isn't really a deal. Make a deal opt-in, and maybe call it something else. The base object should be the status of your communication with someone, with context. People also use a CRM to manage relationships, like networking, not only sales.

Where it showed up: the backlink-outreach demo had to put its real progress ("Prospect found → Contacted → Replied → Link live") in a custom field beside the built-in sales Stage ("Demo booked", "Contract sent"). Each "deal" there is really a conversation with a publication.

## In short

- **One container: a List.** A list is a context: _Backlink outreach_, _Networking_, _YouTubers_. It holds people or companies, and anyone can be in many lists.
- **An optional status per list.** A list can have its own **stages**. Each person (or company) in it has one stage there, e.g. "Backlink outreach: Replied" and "Networking: Met at conference". With no stages, a list is just a group (a tag).
- **The timeline stays where it is**, on the person or company: email, meetings, notes and tasks, plus a line for each stage change.
- **Deals become opt-in**, a setting for teams that sell. They're off for new installs and stay on for installs that already have deals. Nothing about the deal tables changes.

## What exists today

| Piece                                              | What it does                                                                                                                                                                                   | Gap                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deals (`deal`, `deal_contact`)                     | The only status anywhere. Needs a company and an owner. One fixed sales pipeline (`DEAL_STAGES`: Demo booked … Closed won/lost), amount, close date. The Overview dashboard is built on deals. | Outreach and networking aren't sales. Making `company_id` nullable or the stages custom would need a table rebuild (AGENTS.md forbids it: on D1 it cascades deletes). |
| Tags                                               | None. No tag table, no multi-select field type.                                                                                                                                                | —                                                                                                                                                                     |
| Custom fields                                      | `SELECT` holds one option per record.                                                                                                                                                          | One value per record: a person can't be "Replied" in one context and "Met" in another. That's the demo's "Outreach stage" workaround.                                 |
| Saved views                                        | Named URL filters, personal or shared, in a dropdown. MCP tools exist.                                                                                                                         | Nothing to filter _by_ for "YouTuber" or "Replied".                                                                                                                   |
| Timeline (`activity`)                              | Notes, calls, email, meetings, tasks (with due dates), `STAGE_CHANGE`. Linked to a company, contact or deal.                                                                                   | Already the "conversation with context". It just has no status beside it.                                                                                             |
| CSV import                                         | Matches rows by email, then creates or updates. No record of which file.                                                                                                                       | Can't say "everyone in this file, at stage X".                                                                                                                        |
| LinkedIn import (`feat/linkedin-import`, unmerged) | `linkedin_connection` (contact × member, `connectedOn`), a "Connected to" filter, an MCP filter.                                                                                               | Records **who on the team knows them**: a fact, not a list or a status.                                                                                               |
| Bulk actions                                       | Owner, company, archive, restore, purge. Selection is one 25-row page.                                                                                                                         | No "add to list", "set stage" or "all matching".                                                                                                                      |

## How others do it

| Product                                         | Container                                                              | Status lives on                                                                          | Sales pipeline                                                  | Networking                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| **Attio**                                       | **Lists** of one object (people or companies). Records can be in many. | The **list entry**: list-only attributes, typically a status, shown as a board.          | Deals is one more object; workspaces turn objects on or off.    | A list with a status, like any other. |
| **Folk**                                        | **Groups**, in the sidebar. Contacts can be in many.                   | A per-group single-select **Status**. Pipeline view = group by it. Fields are per group. | Deals are optional, added to a group as "Deal + pipeline view". | A group.                              |
| **HubSpot**                                     | **Segments** (formerly Lists): static or filter-driven.                | Lifecycle stage and lead status on the contact (global).                                 | Deals with pipelines: the core.                                 | Not really served.                    |
| **Clay** (clay.com)                             | **Tables**, each filled by a source.                                   | A column in the table.                                                                   | None; it pushes to a CRM.                                       | —                                     |
| **Dex**                                         | **Groups** and tags.                                                   | No stages. A **keep-in-touch cadence** per contact, then a "due" nudge.                  | None. Users ask for one and use groups as stages.               | The whole product.                    |
| **Mesh** (Clay's personal CRM, renamed in 2026) | Groups, auto-built from email, calendar and LinkedIn.                  | No stages. "Reconnect" suggestions for people you've gone quiet with.                    | None.                                                           | The whole product.                    |

What they share:

- **Status belongs to the context, not the person.** That's Attio's list entry and Folk's group status.
- **Deals are a separate, optional object.**
- **Networking tools skip stages** and track _recency_: when you last talked and when you're due.

## Options

### A. Lists with optional stages; deals opt-in (recommended)

- **List** = a context, holding people **or** companies (chosen per list). The backlink targets are publications, so companies matter.
- **Stages per list**, optional. Each stage has a kind (_open_, _done_ or _dropped_), so "everything still open, across lists" and win-rate-style counts still work. A new list starts from a template:
  - _Outreach_: To contact → Contacted → Replied → Done ✓ / Not interested ✗
  - _Networking_: To meet → Met → Keep in touch → Dormant
  - _Plain_: no stages
- **Follow-up cadence**, optional per list (Dex/Mesh): "due after 30 days quiet". An entry in an open stage with no activity for that long shows as **Due**. That's the networking view.
- **Views of a list:** Table and Board (columns = stages). Both live in the URL. A saved view keeps the search, filters, sort and columns, not the list, its stage tab or the board.
- **On a person or company:** a **Lists** card lists each membership with its stage, as a dropdown to change it. The timeline below gets "Backlink outreach: Contacted → Replied" lines. The next step is an ordinary task (tasks already have due dates).
- **Deals:** a setting (Settings → Workspace → "Deals: track sales with amounts and close dates"). When it's on, the Deals page, sheet sections, Overview charts and deal MCP tools appear. A list entry can "Create deal" prefilled with the person and company. When it's off, they're all hidden. The data is untouched.
- **Overview with deals off:** a stage summary per list, Due follow-ups, overdue tasks and recent activity.

### B. One global relationship status, plus plain lists

- A single status on each contact and company (e.g. New, Contacted, Replied, Warm, Customer, Dormant), like HubSpot's lead status. Lists are plain groups.
- Pros: simplest, with one column to read.
- Cons: breaks the moment someone is in two contexts. An editor who's a backlink target and someone you met at a conference can't be "Replied" and "Met" at once. That's exactly Ben's two examples.

### C. Generalize deals into custom pipelines

- Rename Deals to something like "Opportunities", allow many pipelines with custom stages, and make company and amount optional. Lists stay separate.
- Pros: one place for every status, and sales teams keep a familiar board.
- Cons: two concepts (lists group people, pipelines track them) for one job. It also needs `deal.company_id` nullable and `deal.stage` un-enumed, which means changing a column's nullability or type. That rebuilds the `deal` table, which AGENTS.md rules out (the cascade deletes `deal_contact` and deal activities). A parallel new table would leave two deal-like things.

**Recommendation: A.** It answers both asks with one new concept, keeps deals byte-for-byte for teams that sell, and is purely additive.

## Naming

| Thing                      | Name in the UI                                    | Why                                                                                                                       |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The container              | **List**                                          | Familiar, and covers both "a group" and "a pipeline". _Campaign_ implies sending email; _Pipeline_ scares off networking. |
| A person's state in a list | **Stage**, shown as "Backlink outreach · Replied" | Readable on its own. We don't need a noun for the row itself ("entry" stays internal).                                    |
| Conversations and notes    | **Timeline** (as today)                           | Already the "communication with context". _Conversation_ is taken by email threads.                                       |
| Sales objects              | **Deals**, kept                                   | Now only for selling, where "deal" is the right word. Renaming would also churn existing installs and MCP clients.        |

_Relationship_ was the other candidate for the base object. It reads like an edge between two people (that's what `linkedin_connection` is), and it says nothing about stage, so we skip it.

## Data model (A), additive only

Three new tables, plus two new nullable or defaulted columns. Nothing existing changes shape.

```ts
// A context: a group of people or companies, optionally with stages.
list: {
  id, organization_id,
  entity: "CONTACT" | "COMPANY",
  name, color, description,
  follow_up_days: integer | null,     // "due after N days quiet"
  created_by -> user (set null), archived_at, created_at, updated_at,
}
  unique (organization_id, lower(name)) where archived_at is null

// A list's stages, in order.
list_stage: {
  id, organization_id,
  list_id -> list (cascade),
  name, color,
  kind: "OPEN" | "DONE" | "DROPPED",
  position, archived_at,
}
  index (list_id, position)

// Someone (or some company) in a list, at a stage.
list_entry: {
  id, organization_id,
  list_id -> list (cascade),
  contact_id -> contact (cascade) | null,
  company_id -> company (cascade) | null,   // exactly one, matching list.entity
  stage_id -> list_stage (set null) | null,
  stage_changed_at, added_by -> user (set null), added_at,
}
  unique (list_id, contact_id) where contact_id is not null
  unique (list_id, company_id) where company_id is not null
  index (organization_id, contact_id)
  index (organization_id, company_id)
  index (list_id, stage_id)

// New columns:
activity.list_entry_id -> list_entry (set null) | null  // stage-change lines
workspace.deals_enabled boolean not null default false  // migration sets it on where deals exist
```

- **Tenancy.** Every repository function takes `organizationId`. Adds insert only records of the organization (`insert … select … where organization_id = ?`), and a stage is accepted only if it belongs to the entry's list.
- **Exclusivity without locks.** Partial unique indexes make adds idempotent (use `onConflictDoUpdate({ targetWhere })`, per AGENTS.md). A stage change is `update … where id = ? and stage_id is ? returning`, and the activity line goes in the same `runBatch`.
- **Stage changes on the timeline** reuse `STAGE_CHANGE` with `contact_id`/`company_id` and the new `list_entry_id`, so they show on the person and the company with no new feed.
- **D1 limits.** Chunk ids under 100 parameters. "Add all matching" pages through the filtered ids on the server.
- **Deals off is a display switch, not a data switch.** Turning it on later shows everything as it was.
- **Lists are new,** so the earlier `contact_list` draft is replaced, not migrated.

## Flows

**Outreach (backlink demo).**

1. New list "Backlink outreach" (Companies, Outreach template).
2. Import a CSV of publications, landing at _To contact_.
3. Board view: drag to _Contacted_. The editor's reply is captured from Gmail onto the company's timeline.
4. Move to _Replied_ and add a task "Send draft, Fri".
5. Move to _Done_ when the link is live. If a publication wants a paid placement and the team sells, "Create deal".

**Networking.**

1. New list "Networking" (People, Networking template, follow up after 60 days).
2. Import LinkedIn connections at _Met_, or add people after a conference.
3. Calendar meetings and emails file onto their timelines and reset the clock.
4. The **Due** filter shows who's gone quiet. Log a note and they drop off.

**Plain group.** "YouTubers" with no stages works like a tag: chips on the person, a sidebar count, a filter.

## Imports

- The CSV and LinkedIn imports end with **Add to a list** (new, existing or none) and **Starting stage**.
- Existing matched records are added too, and keep their stage if they're already in that list.
- The LinkedIn import still writes `linkedin_connection`. The list and stage are extra.
- A CSV column can carry the stage (a column named "Stage" or the list's name), so a spreadsheet tracker moves over in one go.

## Bulk

- Add to list, Remove from list, Set stage.
- Each works on the selected rows **or all N matching** the current filters, done on the server.

## MCP tools

| Tool                                                               | Does                                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_lists`                                                       | Lists with entity, stages and counts per stage.                                                                                                 |
| `create_list` / `update_list` / `delete_list`                      | Name, entity, template or stages, follow-up days, archive. Deleting never deletes records.                                                      |
| `set_list_stages`                                                  | Add, rename, reorder or archive stages.                                                                                                         |
| `add_to_list`                                                      | By ids, emails or domains, **or** by `list_contacts`/`list_companies` filters, with an optional stage. Reports added, already there, not found. |
| `remove_from_list`                                                 | By ids, emails or domains.                                                                                                                      |
| `set_stage`                                                        | Move one or many entries. Logs the timeline line.                                                                                               |
| `list_entries`                                                     | A list's entries, filtered by stage, kind or Due, with last activity.                                                                           |
| `list_contacts` / `list_companies` / `get_contact` / `get_company` | Gain `lists` and `stages` filters and return memberships with stages.                                                                           |
| Deal tools                                                         | Refuse with "Deals are turned off in Settings" while off.                                                                                       |

So an agent can do "move everyone in Backlink outreach who replied this week to Replied" or "who in Networking is due?" without knowing about deals.

## Build order

1. Tables, repositories, services and the organization-isolation test. Lists without stages, the sidebar section, chips, filter and bulk add.
2. Stages: board view, the Lists card on the sheet, timeline lines, bulk set stage.
3. The import step (CSV now; LinkedIn once `feat/linkedin-import` merges).
4. The deals setting and the Overview without deals.
5. Follow-up cadence and Due.
6. MCP tools, alongside each step.

## Questions for Ben (recommended answers)

1. **Lists double as tags, no separate tag system?** _Yes._
2. **Lists of people only, or companies too?** _Both, chosen per list._ Backlink targets are publications.
3. **Shared or private lists?** _All shared._ Private later if asked.
4. **Status per list, as above, rather than one global status?** _Yes._ That's the "Replied here, Met there" case.
5. **Names:** List, Stage, Timeline, and keep "Deals" for sales? _Yes._
6. **Deals off for new installs, on for installs that already have deals?** _Yes._
7. **Sidebar:** Contacts, Companies, Overview, Deals (when on), then a **Lists** section with counts. This replaces the Directory tabs. _Yes._
8. **LinkedIn import default:** _No list._ Connections run into the thousands. One click picks a list and starting stage.
9. **Follow-up cadence (Due) in the first version?** _Yes, as one number per list._ It's what makes networking useful.
10. **Overview with deals off:** stage counts per list, Due and overdue tasks? _Yes._
