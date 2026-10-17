import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { pokeRuns } from "@/server/features/team-agents/runtime/poke";
import { AgentRunService } from "@/server/features/team-agents/services/AgentRunService";
import { TeamAgentService } from "@/server/features/team-agents/services/TeamAgentService";

// Team agents for AI clients: see them and their recent runs, and run a live
// one by hand. Building, deploying and changing an agent stay with people in
// the CRM, where the version is reviewed.

export const teamAgentTools = {
  list_team_agents: crmTool({
    description:
      "The team's agents (and the caller's own drafts): name, status, what triggers them and how many runs they have had.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, context) => TeamAgentService.list(context),
  }),

  get_team_agent_runs: crmTool({
    description:
      "A team agent's most recent runs: status, trigger, summary or failure, tokens and cost, and the actions each took.",
    risk: "read",
    input: z
      .object({
        agentId: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(10),
      })
      .strict(),
    handler: async ({ agentId, limit }, context) => {
      const runs = await AgentRunService.history(context, agentId, limit);
      return runs.map(({ events: _events, ...run }) => run);
    },
  }),

  run_team_agent: crmTool({
    description:
      "Run a live team agent now, as a person's Run now does. It runs its deployed version with the permissions that version was approved with. Returns the queued run's id.",
    risk: "write",
    input: z.object({ agentId: z.string().min(1) }).strict(),
    handler: async ({ agentId }, context) => {
      const run = await AgentRunService.runNow(context, {
        agentId,
        clientRequestId: crypto.randomUUID(),
      });
      pokeRuns(context.organizationId);
      return run;
    },
  }),
};
