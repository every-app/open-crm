import { defineTools, everyApp } from "@every-app/sdk/server";
import { fieldTools } from "@/server/everyapp/tools/fields";
import { workspaceTools } from "@/server/everyapp/tools/workspace";

// The CRM's tools, served by the Every App gateway: its one MCP connector
// lists them as `crm_<tool>` beside every other app's, and this app's own
// host serves them under their names. The gateway signs in the person,
// applies the connection's read-only or read-write choice, and calls a tool
// here with a verified identity; the CRM never speaks MCP itself.

const INSTRUCTIONS =
  "The CRM's companies, contacts and deals. Never guess record ids: search or list first. Everything is scoped to the caller's organization.";

// Each feature declares its tools in src/server/everyapp/tools/<feature>.ts
// with crmTool() and adds its map here.
const tools = {
  ...workspaceTools,
  ...fieldTools,
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
