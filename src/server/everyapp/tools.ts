import { defineTools, everyApp } from "@every-app/sdk/server";
import { activityTools } from "@/server/everyapp/tools/activities";
import { bulkTools } from "@/server/everyapp/tools/bulk";
import { companyTools } from "@/server/everyapp/tools/companies";
import { contactTools } from "@/server/everyapp/tools/contacts";
import { dashboardTools } from "@/server/everyapp/tools/dashboard";
import { dealTools } from "@/server/everyapp/tools/deals";
import { fieldTools } from "@/server/everyapp/tools/fields";
import { mailTools } from "@/server/everyapp/tools/mail";
import { savedViewTools } from "@/server/everyapp/tools/savedViews";
import { searchTools } from "@/server/everyapp/tools/search";
import { slackTools } from "@/server/everyapp/tools/slack";
import { teamAgentTools } from "@/server/everyapp/tools/teamAgents";
import { trackingTools } from "@/server/everyapp/tools/tracking";
import { workspaceTools } from "@/server/everyapp/tools/workspace";

// The CRM's tools, its one API (docs/maintainers/mcp.md), served by the Every
// App gateway: its MCP connector lists them as `crm_<tool>` beside every
// other app's, and this app's own host serves them under their names at
// /mcp. The gateway signs in the person, applies the connection's read-only
// or read-write choice (and hides destructive tools from everyone), and
// calls a tool here with a verified identity; the CRM never speaks MCP
// itself.

const INSTRUCTIONS =
  "The CRM's companies, contacts and deals, their timelines, custom fields, captured email and meetings, website activity, team agents and settings. Never guess ids: search_records or a list tool first. People are named by email. Everything is scoped to the caller's organization.";

// Each feature declares its tools in src/server/everyapp/tools/<feature>.ts
// with crmTool() and adds its map here.
const tools = {
  ...workspaceTools,
  ...searchTools,
  ...companyTools,
  ...contactTools,
  ...dealTools,
  ...fieldTools,
  ...activityTools,
  ...mailTools,
  ...trackingTools,
  ...dashboardTools,
  ...bulkTools,
  ...savedViewTools,
  ...teamAgentTools,
  ...slackTools,
};

/**
 * Answers the gateway's tools contract (`/__everyapp/tools/*`): the catalog
 * at deploy, and each call. Loaded on the first tools request only.
 */
export const everyAppTools = everyApp<Env>(
  () => new Response("Not found", { status: 404 }),
  {
    tools: defineTools(tools, { instructions: INSTRUCTIONS }),
  },
);
