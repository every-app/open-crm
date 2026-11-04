/**
 * OpenCRM on an Every App gateway. The gateway signs people in and decides
 * who may open the CRM, serves its tools on the gateway's one MCP connector,
 * and holds each member's Google and Microsoft connections for mail capture,
 * so a deploy needs no settings of its own. Everything it can be given is an
 * optional feature (`features`, below), with its setup steps: `everyapp
 * configure crm` walks them, and the gateway and `everyapp status` show each
 * one's state. See docs/maintainers/every-app.md.
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
      why: "Members connect their Gmail and Google Calendar, read only, so their work conversations and meetings are filed on companies and contacts.",
    },
    "microsoft-365": {
      scopes: [
        "https://graph.microsoft.com/User.Read",
        "https://graph.microsoft.com/Mail.Read",
      ],
      why: "Members connect their Outlook mail, read only, so their work conversations are filed on companies and contacts.",
    },
  },
  // Optional, each all or nothing: the CRM opens without any of them, and
  // the feature that needs one says so where it is used.
  features: {
    google: {
      name: "Gmail and Google Calendar",
      why: "Members connect their Gmail and Google Calendar, read only, so conversations and meetings are filed on companies and contacts.",
      steps: [
        "In the Google Cloud console, enable the Gmail API and the Google Calendar API: https://console.cloud.google.com/apis/library",
        "Create an OAuth client of type Web application: https://console.cloud.google.com/apis/credentials",
        "Redirect URI: {gatewayUrl}/connect/google-workspace/callback. Consent screen scopes: gmail.readonly and calendar.readonly.",
      ],
      capabilities: ["google-workspace"],
    },
    microsoft: {
      name: "Outlook",
      why: "Members connect their Outlook mail, read only, so conversations are filed on companies and contacts.",
      steps: [
        "Register an application for accounts in any organizational directory and personal Microsoft accounts: https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
        "Web redirect URI: {gatewayUrl}/connect/microsoft-365/callback. Delegated Microsoft Graph permissions: User.Read, Mail.Read and offline_access.",
        "Create a client secret. It expires after the period you pick; set a new one before it does.",
      ],
      capabilities: ["microsoft-365"],
    },
    // docs/maintainers/runbooks/erase-organization.md
    erasure: {
      name: "Organization erasure",
      why: "Set only while an operator erases an organization: it signs the erasure requests. Unset it afterwards.",
      steps: [
        "Follow the runbook: https://github.com/every-app/open-crm/blob/main/docs/maintainers/runbooks/erase-organization.md",
      ],
      secrets: [
        {
          name: "ERASURE_SECRET",
          how: "A long random value, e.g. openssl rand -base64 32; the erasure script signs with the same value.",
        },
      ],
    },
  },
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
