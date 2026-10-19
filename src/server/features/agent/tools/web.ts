import { openrouter } from "@openrouter/ai-sdk-provider";
import { webFetch } from "@/server/features/team-agents/runtime/webFetch";
import type { ToolGroup } from "./context";

// The web as the CRM's agent had it: searching it (the CRM's web_search) and
// reading a page (its harness web_fetch, which the workspace-profile pass
// reads our own site with), on the same web_fetch as the team agents.

/**
 * The CRM's web_search, eve's built-in that its model's provider ran (the AI
 * Gateway's Parallel search). Here it is OpenRouter's web search server tool
 * on the same engine with Parallel's ten results, as the builder has it: it
 * searches inside the model call, whose cost includes the search, so the
 * session's meter bills it with the call. The builder's chat uses it too.
 */
export const webSearch = openrouter.tools.webSearch({
  engine: "parallel",
  maxResults: 10,
});

export const webTools: ToolGroup = () => ({
  web_search: webSearch,
  web_fetch: webFetch,
});
