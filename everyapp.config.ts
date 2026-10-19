/**
 * Open CRM on an Every App gateway. The gateway signs people in and decides
 * who may open the CRM, serves its agent tools on the gateway's one MCP
 * connector, and holds the model (OpenRouter) and Context.dev keys and the
 * Google and Microsoft OAuth clients for mail capture, so a deploy needs no
 * settings of its own. See docs/maintainers/every-app.md.
 *
 * One manifest, two shapes:
 *
 * - Fork (self-hosted gateway, or an organization's own copy): D1, one
 *   organization (EVERY_APP_ORG_ID, set by the deploy).
 *
 *     pnpm deploy:everyapp
 *
 * - First party (one shared Worker for every organization on a hosted
 *   gateway): Postgres through Hyperdrive, which `everyapp deploy` creates
 *   from POSTGRES_DATABASE_URL in .everyapp/secrets.env and migrates before
 *   it uploads.
 *
 *     pnpm deploy:everyapp:first-party   # OPEN_CRM_DATABASE=postgres everyapp deploy --shared
 *
 *   pnpm dev                              # everyapp dev: D1, behind a gateway-lite
 */
const postgres = process.env.OPEN_CRM_DATABASE === "postgres";

// Where the Postgres database runs, as a cloud region in Cloudflare's
// placement form (aws:us-east-1, gcp:europe-west1, azure:westeurope).
// Deployed, the Worker serves requests beside it, since a request's queries
// cross to the database one after another. Unset, AWS us-east-1, beside
// OpenSEO's; set OPEN_CRM_DATABASE_REGION for a database elsewhere.
const databaseRegion = process.env.OPEN_CRM_DATABASE_REGION ?? "aws:us-east-1";

export default {
  id: "crm",
  name: "CRM",
  description:
    "Companies, contacts and deals, kept up to date by a research agent.",
  resources: {
    // The first-party shape keeps its data in Postgres and has no D1.
    ...(postgres ? { hyperdrive: [{ name: "HYPERDRIVE" }] } : { d1: ["DB"] }),
    durableObjects: [
      // The research agent: one instance per task or record conversation.
      { name: "CRM_AGENT", className: "CrmAgent" },
    ],
  },
  ...(postgres
    ? {
        database: { provider: "postgres" as const, region: databaseRegion },
        migrations: {
          engine: "drizzle" as const,
          dialect: "postgresql" as const,
          dir: "drizzle/pg",
          config: "drizzle/pg.config.ts",
        },
      }
    : {
        migrations: {
          engine: "drizzle" as const,
          dir: "drizzle/sqlite",
          config: "drizzle/sqlite.config.ts",
          binding: "DB",
        },
      }),
  // The agent's model and its web research (Perplexity's Sonar models), through
  // the gateway's AI proxy and its OPENROUTER_API_KEY.
  providers: ["openrouter"],
  // What the CRM calls with a key only the gateway holds (integrationFetch).
  // The gateway attributes each call to the organization in the request's
  // identity, or, from the agent and the cron, in `x-everyapp-org`
  // (src/server/lib/gateway-attribution.ts).
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
      why: "Members connect their Gmail and Google Calendar, read only, so their work conversations and meetings are filed on companies and contacts.",
    },
    "microsoft-365": {
      access: "write",
      why: "Members connect their Outlook mail, read only, so their work conversations are filed on companies and contacts.",
    },
    // The gateway completes Slack's token endpoint with its client; the CRM
    // keeps the workspace's tokens (src/server/features/slack).
    slack: {
      access: "write",
      why: "Connects the workspace's Slack so team agents can post to an approved channel.",
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
  // And the health check, which says only whether the CRM and its database
  // answer (src/server/features/health).
  public: [
    { path: "/t/*", methods: ["GET"] },
    { path: "/t/e", methods: ["POST"] },
    { path: "/health", methods: ["GET"] },
  ],
} as const;
