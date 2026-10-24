/**
 * OpenCRM on an Every App gateway. The gateway signs people in and decides
 * who may open the CRM, serves its agent tools on the gateway's one MCP
 * connector, and holds the model (OpenRouter) and Context.dev keys and the
 * Google and Microsoft OAuth clients for mail capture, so a deploy needs no
 * settings of its own. Each setting below says whether the CRM opens without
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
    "Companies, contacts and deals, kept up to date by a research agent.",
  icon: "/everyapp-icon.svg",
  resources: {
    d1: ["DB"],
    durableObjects: [
      // The research agent: one instance per task or record conversation.
      { name: "CRM_AGENT", className: "CrmAgent" },
    ],
  },
  migrations: {
    engine: "drizzle" as const,
    dir: "drizzle/sqlite",
    config: "drizzle/sqlite.config.ts",
    binding: "DB",
  },
  // Through the gateway's AI proxy and its OPENROUTER_API_KEY. Required: a
  // CRM kept up to date by a research agent is not much without its model.
  providers: [
    {
      id: "openrouter",
      why: "The research agent's model and its web research (Perplexity's Sonar models), through the gateway's AI proxy.",
    },
  ],
  // What the CRM calls with a key only the gateway holds (integrationFetch).
  // The gateway attributes each call to the organization in the request's
  // identity, or, from the agent and the cron, in `x-everyapp-org`
  // (src/server/lib/gateway-attribution.ts). Only Context.dev is required:
  // mail, calendar and Slack are features whose connect pages say what is
  // missing until the gateway holds their client.
  capabilities: {
    context: {
      access: "read",
      why: "Company brand data, LinkedIn profiles and website extraction for the research agent.",
    },
    // Each member connects their own mailbox; the gateway completes the
    // token endpoints with its client and the CRM keeps the member's tokens
    // (src/server/features/mailbox).
    "google-workspace": {
      access: "write",
      optional: true,
      why: "Members connect their Gmail and Google Calendar, read only, so their work conversations and meetings are filed on companies and contacts.",
    },
    "microsoft-365": {
      access: "write",
      optional: true,
      why: "Members connect their Outlook mail, read only, so their work conversations are filed on companies and contacts.",
    },
    // The gateway completes Slack's token endpoint with its client; the CRM
    // keeps the workspace's tokens (src/server/features/slack).
    slack: {
      access: "write",
      optional: true,
      why: "Connects the workspace's Slack so team agents can post to an approved channel.",
    },
  },
  // The CRM's own settings (`everyapp secret set <NAME> --app crm`), all
  // optional: the feature that needs one says so where it is used.
  secrets: [
    // The key mail, calendar and Slack tokens are encrypted under
    // (src/server/lib/tokenCrypto.ts). Changing it means connecting again.
    {
      name: "TOKEN_ENCRYPTION_KEY",
      optional: true,
      why: "Needed before anyone connects mail, a calendar or Slack: their tokens are encrypted under it. 32 or more random characters, e.g. openssl rand -base64 32.",
    },
    {
      name: "GITHUB_TOKEN",
      optional: true,
      why: "Raises GitHub's rate limit when the agent matches people to GitHub profiles. Any classic token with no scopes will do.",
      docs: "https://github.com/settings/tokens",
    },
    // src/server/lib/openrouter.ts
    {
      name: "OPENROUTER_MODEL",
      optional: true,
      why: "The OpenRouter model the agent runs on, for a deployment that wants another than GPT-6 Luna. The key itself, OPENROUTER_API_KEY, is the gateway's.",
    },
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
  // And the health check, which says only whether the CRM and its database
  // answer (src/server/features/health).
  public: [
    { path: "/t/*", methods: ["GET"] },
    { path: "/t/e", methods: ["POST"] },
    { path: "/health", methods: ["GET"] },
    // An operator erasing an organization, with requests signed by
    // ERASURE_SECRET; 404 while it is unset (src/server/features/erasure).
    { path: "/internal/erase-organization", methods: ["POST"] },
  ],
} as const;
