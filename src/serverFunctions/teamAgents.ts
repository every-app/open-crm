import { AgentRevisionService } from "@/server/features/team-agents/services/AgentRevisionService";
import { createServerFn } from "@tanstack/react-start";
import { env, waitUntil } from "cloudflare:workers";
import { stopRunSession } from "@/server/features/team-agents/runtime/dispatch";
import { pokeRuns } from "@/server/features/team-agents/runtime/poke";
import { AgentRunService } from "@/server/features/team-agents/services/AgentRunService";
import { BuilderResourceService } from "@/server/features/team-agents/services/BuilderResourceService";
import { TeamAgentService } from "@/server/features/team-agents/services/TeamAgentService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  agentHistorySchema,
  agentIdSchema,
  agentTransitionSchema,
  agentVersionSchema,
  builderResourcesSchema,
  cancelRunSchema,
  deployAgentSchema,
  retryRunSchema,
  reviseAgentSchema,
  runAgentSchema,
  saveFilesSchema,
} from "@/types/schemas/team-agents";

// Team agents: the agents index and detail, review and deploy, runs, and the
// builder chats around the chat itself (which runs over
// /agents/crm-agent/<sessionId>, as a record's Agent tab does).

export const listTeamAgents = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => TeamAgentService.list(context));

export const getTeamAgent = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentIdSchema)
  .handler(async ({ data, context }) =>
    TeamAgentService.get(context, data.agentId),
  );

export const getTeamAgentFiles = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentVersionSchema)
  .handler(async ({ data, context }) =>
    TeamAgentService.files(context, data.agentId, data.versionId),
  );

export const getTeamAgentRuns = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentHistorySchema)
  .handler(async ({ data, context }) =>
    AgentRunService.history(context, data.agentId, data.limit),
  );

export const getTeamAgentActivity = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentHistorySchema)
  .handler(async ({ data, context }) =>
    TeamAgentService.activity(context, data.agentId, data.limit),
  );

export const deployTeamAgent = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(deployAgentSchema)
  .handler(async ({ data, context }) => TeamAgentService.deploy(context, data));

export const changeTeamAgentStatus = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(agentTransitionSchema)
  .handler(async ({ data, context }) =>
    TeamAgentService.transition(context, data.agentId, data.action),
  );

export const deleteTeamAgent = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(agentIdSchema)
  .handler(async ({ data, context }) =>
    TeamAgentService.remove(context, data.agentId),
  );

export const reviseTeamAgent = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(reviseAgentSchema)
  .handler(async ({ data, context }) =>
    AgentRevisionService.revise(context, data),
  );

export const saveTeamAgentFiles = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(saveFilesSchema)
  .handler(async ({ data, context }) =>
    AgentRevisionService.saveFiles(context, data),
  );

export const runTeamAgent = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(runAgentSchema)
  .handler(async ({ data, context }) => {
    const run = await AgentRunService.runNow(context, data);
    pokeRuns(context.organizationId);
    return run;
  });

export const retryTeamAgentRun = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(retryRunSchema)
  .handler(async ({ data, context }) => {
    const run = await AgentRunService.retryRun(context, data);
    pokeRuns(context.organizationId);
    return run;
  });

export const cancelTeamAgentRun = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(cancelRunSchema)
  .handler(async ({ data, context }) => {
    const result = await AgentRunService.cancelRun(context, data);
    // The row stopped it; this only stops it spending.
    if (result.cancelled && result.sessionId) {
      waitUntil(
        stopRunSession(env, context.organizationId, data.runId).catch(
          (error: unknown) => {
            console.warn("[team-agents] could not reach a stopped run", error);
          },
        ),
      );
    }
    return { cancelled: result.cancelled };
  });

export const searchBuilderResources = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(builderResourcesSchema)
  .handler(async ({ data, context }) =>
    BuilderResourceService.search(context, data.q),
  );
