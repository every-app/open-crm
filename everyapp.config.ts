/**
 * OpenCRM on an Every App gateway. The gateway signs people in and decides
 * who may open the CRM, serves its tools on the gateway's one MCP connector,
 * and holds each member's Google and Microsoft connections for mail capture,
 * so a deploy needs no settings of its own. Each setting below says whether the CRM opens without
 * it (`optional`) and why it is there (`why`): the gateway, `everyapp status`
 * and the end of `everyapp deploy` show them. See docs/maintainers/every-app.md.
 *
 *   pnpm deploy:everyapp   # D1, pinned to the organization (EVERY_APP_ORG_ID)
 *   pnpm dev               # everyapp dev: D1, behind a gateway-lite
 */
export default {
  id: "crm",
  name: "OpenCRM",
  description:
    "Companies, contacts and deals, with mail, meetings and website visits filed on them.",
  icon: "/everyapp-icon.svg",
  resources: {
    d1: ["DB"],
  },
  migrations: {
    engine: "drizzle" as const,
    dir: "drizzle/sqlite",
    config: "drizzle/sqlite.config.ts",
    binding: "DB",
  },
  // What the CRM calls with a key only the gateway holds (integrationFetch).
  // The gateway attributes each call to the organization in the request's
  // identity, or, from the cron, in `x-everyapp-org`
  // (src/server/lib/gateway-attribution.ts). Mail and calendar are features
  // whose connect pages say what is missing until the gateway holds their
  // client.
  capabilities: {
    // Each member connects their own mailbox in Settings → Connections; the
    // gateway runs the OAuth flow, holds the connection and puts its token on
    // the CRM's calls (src/server/features/mailbox/providers/gateway.ts). The
    // scopes are the provider's own; the gateway adds the sign-in ones and
    // refuses a token carrying more.
    "google-workspace": {
      scopes: ["gmail.readonly", "calendar.readonly"],
      optional: true,
      why: "Members connect their Gmail and Google Calendar, read only, so their work conversations and meetings are filed on companies and contacts.",
    },
    "microsoft-365": {
      scopes: [
        "https://graph.microsoft.com/User.Read",
        "https://graph.microsoft.com/Mail.Read",
      ],
      optional: true,
      why: "Members connect their Outlook mail, read only, so their work conversations are filed on companies and contacts.",
    },
  },
  // The CRM's own settings (`everyapp secret set <NAME> --app crm`), all
  // optional: the feature that needs one says so where it is used.
  secrets: [
    // docs/maintainers/runbooks/erase-organization.md
    {
      name: "ERASURE_SECRET",
      optional: true,
      why: "Set only while an operator erases an organization: it signs the erasure requests. Unset it afterwards.",
    },
  ],
  // Every member of the organization works in the CRM.
  access: "everyone",
  // Nothing reaches the CRM without a signed-in member but website tracking,
  // which runs on the organization's own website for anonymous visitors
  // (docs/maintainers/website-tracking.md): the loader and per-site tracker
  // scripts, and the collector they POST to. The tracker never sends a
  // preflight (a text/plain beacon), so OPTIONS stays private. The gateway's
  // tool calls (`/__everyapp/tools/*`) carry their own gateway-signed tokens.
  // /health is not here: a signed-in member or a personal access token reaches
  // it, and the gateway's own https://<gateway>/health is the public liveness
  // check.
  public: [
    { path: "/t/*", methods: ["GET"] },
    { path: "/t/e", methods: ["POST"] },
    // An operator erasing an organization, with requests signed by
    // ERASURE_SECRET; 404 while it is unset (src/server/features/erasure).
    { path: "/internal/erase-organization", methods: ["POST"] },
  ],
} as const;
