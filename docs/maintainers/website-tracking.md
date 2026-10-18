# Website tracking

An organization puts one tag on its own website. The tag records page views
and clicks for each visitor, with first-touch and last-touch UTM attribution,
and turns form submissions into contacts. It is ported from the CRM's
`docs/tracking.md`. No provider credential is involved. The only requirement
is a few anonymous routes on the CRM's own host.

The code lives in `src/server/features/tracking/`. The settings page is
`src/client/features/tracking/` and the tables are in
`src/db/tracking.schema.ts`.

## What is public, and why

The CRM is private behind the gateway. The tag runs in a stranger's browser on
the customer's website, though, so these routes are declared public in
`everyapp.config.ts`:

| Route            | Method | What                                                                                                                               |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/t/crm.js`      | GET    | The loader. It has no config, so it is cached for a year at the edge.                                                              |
| `/t/<siteId>.js` | GET    | That site's tracker with its config baked in. Cached for 5 minutes, which is how long a pause or rotation takes to reach browsers. |
| `/t/e`           | POST   | The collector. It always answers 204.                                                                                              |

The manifest declares `{ path: "/t/*", methods: ["GET"] }` and
`{ path: "/t/e", methods: ["POST"] }`, and nothing else. How the gateway
treats them (`packages/perimeter` in the Every App repo):

- **Public means auth-optional.** An anonymous visitor's request carries the
  gateway's signed `x-everyapp-public` marker and no identity. The SDK
  verifies the marker, and `everyApp()` calls the handler with
  `user = null`. A signed-in member's request still carries their identity.
  `src/server.ts` sends every `/t/` path to the tracking routes before it
  looks at identity, and the tracking code ignores identity entirely. Any
  other path without a user gets a 404.
- **CSRF.** A cross-site `POST` (`Sec-Fetch-Site: cross-site`) fails the
  gateway's CSRF check. On a public route that failure downgrades the request
  to anonymous instead of refusing it. The member's cookie identity is never
  forwarded on such a request.
- **Headers.** The gateway strips `Cookie`, `Authorization` and every
  `x-everyapp-*` header before forwarding. It adds its security headers
  (HSTS, `nosniff`, `X-Frame-Options`) but no CORS headers. The routes set
  their own: `Access-Control-Allow-Origin: *` and
  `Cross-Origin-Resource-Policy: cross-origin`. Without the second, Chrome
  blocks the beacon's reply on every page view.
- **Preflights.** `OPTIONS` reaches the app only if a public route declares
  it. The tracker never sends a preflight because it posts a `text/plain`
  beacon (or a `no-cors` fetch), so `OPTIONS` is not declared and stays
  private (401).
- **`everyapp dev`.** The gateway-lite runs the same perimeter, so public
  routes behave there as they do in production. Send
  `x-everyapp-dev-anon: 1` (curl) or set the `everyapp_dev_anon=1` cookie
  (browser) to act as an anonymous visitor. A page served from another local
  origin is cross-site, so it is anonymous anyway.

## Which organization a hit belongs to

A public hit carries no identity. The organization comes only from the site
id, `cmp_` plus 64 random bits. It is unique in `tracking_site` and minted
once the site has an allowed domain. Nothing else in the request names an
organization. On a fork (`EVERY_APP_ORG_ID` set), a site id belonging to any
other organization is refused. Rotating the id is the kill switch for a
stolen snippet: the old id stops resolving at once, and its tracker script
empties within the 5-minute cache.

## Abuse bounds on the collector

The collector is the CRM's only unauthenticated write path. Every request
answers 204, so a stranger learns nothing from probing it. Checks run in
this order; the ones that need no database run before the one lookup:

1. Body: at most 32 KB, cut off while it streams, before any parsing.
2. User agent: bots and headless browsers are dropped.
3. Site id shape, `Origin` present, visitor id shape (8 to 64 characters of
   `[A-Za-z0-9_-]`), at most 20 events, and no replays (three or more events
   with the same timestamp).
4. Site lookup: one indexed read. Refuses unknown, rotated or paused sites.
5. `Origin` and each event's host against the allow-list. Off-list events
   are filtered out; the rest of the batch is kept.
6. Rate, charged per accepted event in the database with one conditional
   upsert per counter. The limits are 600 events a minute per site and 120
   per visitor. A refused charge spends nothing.

Stored fields are bounded too: paths and referrers at 512 characters,
labels at 80, UTM values at 120, and forms at 40 fields of 512 characters.
Query strings, password, hidden and file inputs, sensitive field names, card
numbers and IP addresses are never stored.

A form submission becomes a contact under the same rules captured mail
follows (`src/shared/participants.ts`):

- Machine and shared mailboxes are skipped.
- Our own domains are skipped: the members' work domains and the workspace's
  website, as mail capture counts them.
- Deleted (suppressed) addresses and suppressed domains are skipped.
- At most 50 new contacts per organization per hour. Attaching a
  submission to an existing contact costs nothing.

So the worst a scripted attacker can do to one organization is bounded per
minute and per hour, and each event costs them a full HTTP request.

## Retention

The hourly cron tick at minute 30 runs retention for every organization at
once (`TrackingRetentionService`):

1. Page views older than 90 days, cut at a UTC midnight, are rolled into
   `tracked_page_daily`.
2. Those events are deleted in passes of up to 5,000. A run that hits the
   pass limit logs a warning and the next hour continues. A day that gets
   rolled twice keeps the larger count.
3. Visitors whose contact is gone and who have no events left are deleted.
4. Expired rate counters are deleted.
