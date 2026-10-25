import { tool, type ToolSet } from "ai";
import { once } from "remeda";
import { z } from "zod";
import {
  scopedWebFetch,
  webFetch,
} from "@/server/features/team-agents/runtime/webFetch";
import { normalizeUrl, safeHostname } from "@/shared/safe-url";
import { asker, webResearchAccess } from "../lib/perplexity";
import { unavailable } from "../prompt/capabilities";
import { AgentProfileRepository } from "../repositories/AgentProfileRepository";
import type { AgentToolContext, ToolGroup } from "./context";
import { recordHosts } from "./egress";
import { untrusted } from "./untrusted";

// The web as the CRM's agent had it: searching it (the CRM's web_search) and
// reading a page (its harness web_fetch, which the workspace-profile pass
// reads our own site with). A person's chat reads any public page; a
// research session nobody watches reads only its record's own site and the
// pages its searches returned, and no page once it has read captured mail or
// meetings (egress.ts).

/**
 * The CRM's web_search, eve's built-in that its model's provider ran. The
 * agent's model is the gateway's default now, which may be any provider, so
 * the search is a tool of its own: a cited answer from Perplexity's Sonar
 * through the gateway's pinned OpenRouter (lib/perplexity.ts), priced as
 * research_person prices a quick question. The pages it cites are noted for
 * an unattended web_fetch (egress.ts). Without OpenRouter on the gateway it
 * says so, before any budget is spent once the gateway has refused.
 */
export function webSearch(context: Pick<AgentToolContext, "spend" | "egress">) {
  return tool({
    description:
      "Search the open web for public context (news, announcements, a company's own pages) and get a cited answer. Costs research budget. Never put customer text in the question.",
    inputSchema: z.object({
      question: z.string().trim().min(3).max(500),
    }),
    execute: async ({ question }) => {
      const research = await webResearchAccess();
      if (!research) {
        return { ok: false as const, ...unavailable("web research") };
      }
      const charge = context.spend(1);
      if (!charge.ok) return { ok: false as const, reason: charge.reason };
      const answer = await asker(research)(question);
      if (!answer.ok) return { ok: false as const, reason: answer.reason };
      context.egress?.noteSearched(answer.data.citations);
      return {
        ok: true as const,
        answer: untrusted(answer.data.text, "web search"),
        citations: answer.data.citations,
      };
    },
  });
}

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
  const web_search = webSearch(context);
  if (context.attended) return { web_search, web_fetch: webFetch };
  const egress = context.egress;
  if (!egress || egress.closed()) return { web_search };
  return {
    web_search,
    web_fetch: scopedWebFetch({
      hosts: once(() => sessionHosts(context)),
      searched: () => egress.searched(),
      open: () => !egress.closed(),
    }),
  };
};
