import { openrouter } from "@openrouter/ai-sdk-provider";
import type { ToolSet } from "ai";
import { once } from "remeda";
import {
  scopedWebFetch,
  webFetch,
} from "@/server/features/team-agents/runtime/webFetch";
import { normalizeUrl, safeHostname } from "@/shared/safe-url";
import { AgentProfileRepository } from "../repositories/AgentProfileRepository";
import type { AgentToolContext, ToolGroup } from "./context";
import { recordHosts } from "./egress";

// The web as the CRM's agent had it: searching it (the CRM's web_search) and
// reading a page (its harness web_fetch, which the workspace-profile pass
// reads our own site with). A person's chat reads any public page; a
// research session nobody watches reads only its record's own site and the
// pages its searches returned, and no page once it has read captured mail or
// meetings (egress.ts).

/**
 * The CRM's web_search, eve's built-in that its model's provider ran (the AI
 * Gateway's Parallel search). Here it is OpenRouter's web search server tool
 * on the same engine with Parallel's ten results, as the builder has it: it
 * searches inside the model call, whose cost includes the search. The
 * builder's chat uses it too.
 * The pages it cites reach the session as the step's sources, which
 * CrmAgent notes for web_fetch (egress.ts).
 */
export const webSearch = openrouter.tools.webSearch({
  engine: "parallel",
  maxResults: 10,
});

/**
 * The hosts an unattended session's web_fetch may read: its record's
 * company's, and for the workspace-profile task our own website's.
 */
async function sessionHosts(context: AgentToolContext): Promise<string[]> {
  const hosts = await recordHosts(context.organizationId, context.record);
  if (context.task?.kind !== "workspace-profile") return hosts;
  const us = await AgentProfileRepository.workspaceIdentity(
    context.organizationId,
  );
  const ours = us?.website ? safeHostname(normalizeUrl(us.website)) : null;
  return ours ? [...hosts, ours] : hosts;
}

export const webTools: ToolGroup = (context): ToolSet => {
  if (context.attended) return { web_search: webSearch, web_fetch: webFetch };
  const egress = context.egress;
  if (!egress || egress.closed()) return { web_search: webSearch };
  return {
    web_search: webSearch,
    web_fetch: scopedWebFetch({
      hosts: once(() => sessionHosts(context)),
      searched: () => egress.searched(),
      open: () => !egress.closed(),
    }),
  };
};
