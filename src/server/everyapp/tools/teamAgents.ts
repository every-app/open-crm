import { env, waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { pokeRuns } from "@/server/features/team-agents/runtime/poke";
import { AgentRunService } from "@/server/features/team-agents/services/AgentRunService";
import { TeamAgentService } from "@/server/features/team-agents/services/TeamAgentService";
import {
  RUN_STATUSES,
  TEAM_AGENT_STATUSES,
  TRIGGER_TYPES,
} from "@/shared/team-agents";
import { agentTransitionSchema } from "@/types/schemas/team-agents";

// Team agents for AI clients: see them, their versions and runs; run, retry
// and stop runs; pause, resume, archive, restore and delete them. Building
// and deploying a version stays with people in the CRM: deploying is where a
// person approves what a version may read and do.

const agentId = z
  .string()
  .min(1)
  .describe("The agent's id, from list_team_agents.");

const runId = z
  .string()
  .min(1)
  .describe("The run's id, from get_team_agent_runs.");

const AGENTS_PAGE = 50;

const errorOutput = z
  .object({ code: z.string().nullable(), message: z.string().nullable() })
  .nullable()
  .describe("Why it failed or was stopped.");

type RunDetail = Awaited<ReturnType<typeof AgentRunService.runDetail>>;

function runSummary(run: RunDetail) {
  return {
    ...run,
    trigger: run.triggerType,
    version: run.versionNumber,
    error:
      run.errorCode || run.errorMessage
        ? { code: run.errorCode, message: run.errorMessage }
        : null,
  };
}

const runOutput = z.object({
  id: z.string(),
  status: z.enum(RUN_STATUSES),
  trigger: z.enum(TRIGGER_TYPES),
  version: z.number(),
  summary: z.string().nullable(),
  noActionNeeded: z
    .string()
    .nullable()
    .describe("Why none of its actions applied, when it said so."),
  error: errorOutput,
  initiatedBy: z.string().nullable().describe("Who ran it by hand."),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
});

const actionOutput = z.object({
  type: z.string(),
  summary: z.string(),
  status: z.string(),
  target: z
    .object({
      type: z.string().nullable(),
      id: z.string().nullable(),
      label: z.string().nullable(),
    })
    .describe("The record or channel it acted on."),
  error: errorOutput,
  completedAt: z.string().nullable(),
});

function action(row: RunDetail["actions"][number]) {
  return {
    ...row,
    target: { type: row.targetType, id: row.targetId, label: row.targetLabel },
    error:
      row.errorCode || row.errorMessage
        ? { code: row.errorCode, message: row.errorMessage }
        : null,
  };
}

const stepData = z
  .object({ summary: z.string().optional(), toolName: z.string().optional() })
  .catch({});

/** What a step of a run says, as the run's drawer words it. */
function stepText(data: unknown): string | null {
  const { summary, toolName } = stepData.parse(data);
  return summary?.trim() ? summary : (toolName ?? null);
}

const triggerOutput = z.object({
  type: z.enum(TRIGGER_TYPES),
  name: z.string(),
  summary: z.string(),
  event: z
    .string()
    .nullable()
    .describe("The CRM event an EVENT trigger hears."),
  intervalMinutes: z.number().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
});

const versionOutput = z
  .object({
    id: z.string(),
    number: z.number(),
    status: z.string(),
    deployedAt: z.string().nullable(),
    readable: z.boolean(),
    scope: z
      .object({
        mode: z.enum(["SELECTED", "WORKSPACE"]),
        summary: z.string(),
        resources: z.array(
          z.object({ kind: z.string(), id: z.string(), label: z.string() }),
        ),
      })
      .nullable()
      .describe("The records and captured sources it may read."),
    actions: z
      .array(z.object({ type: z.string(), summary: z.string() }))
      .describe("What it may do."),
    access: z.array(z.string()),
  })
  .nullable();

type VersionSummary = NonNullable<
  Awaited<ReturnType<typeof TeamAgentService.get>>["currentVersion"]
>;

function version(summary: VersionSummary | null) {
  if (!summary) return null;
  const manifest = summary.readable ? summary.manifest : null;
  return {
    ...summary,
    scope: manifest?.dataScope ?? null,
    actions: manifest?.actions ?? [],
    access: manifest?.access ?? [],
  };
}

const statusOutput = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(TEAM_AGENT_STATUSES),
});

export const teamAgentTools = {
  list_team_agents: crmTool({
    description:
      "The team's agents and the caller's own drafts: name, status, what triggers them and how many runs they have had. 50 a page, most recently changed first.",
    risk: "read",
    input: z.object({ page: pageInput }).strict(),
    output: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      agents: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          status: z.enum(TEAM_AGENT_STATUSES),
          createdBy: z.string(),
          runCount: z.number(),
          trigger: z
            .object({
              type: z.enum(TRIGGER_TYPES),
              name: z.string(),
              nextRunAt: z.string().nullable(),
            })
            .nullable(),
          updatedAt: z.string(),
        }),
      ),
    }),
    handler: async ({ page }, context) => {
      const { rows, ...rest } = pageOf(
        await TeamAgentService.list(context),
        page ?? 1,
        AGENTS_PAGE,
      );
      return { ...rest, agents: rows };
    },
  }),

  get_team_agent: crmTool({
    description:
      "One team agent: its status, the deployed version with what it may read and do, its triggers, and any newer version waiting for a person to review and deploy.",
    risk: "read",
    input: z.object({ agentId }).strict(),
    output: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      status: z.enum(TEAM_AGENT_STATUSES),
      createdBy: z.string(),
      canManage: z
        .boolean()
        .describe("The caller may pause, archive or delete it."),
      runCount: z.number(),
      currentVersion: versionOutput,
      reviewVersion: versionOutput,
      triggers: z.array(triggerOutput),
    }),
    handler: async ({ agentId: id }, context) => {
      const agent = await TeamAgentService.get(context, id);
      return {
        ...agent,
        currentVersion: version(agent.currentVersion),
        reviewVersion: version(agent.reviewVersion),
      };
    },
  }),

  get_team_agent_runs: crmTool({
    description:
      "A team agent's latest runs: status, trigger, summary or failure, tokens and cost, and the actions each took. get_team_agent_run gives one run's steps.",
    risk: "read",
    input: z
      .object({
        agentId,
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    output: z.object({
      runs: z.array(
        runOutput.extend({
          actions: z.array(
            z.object({
              type: z.string(),
              summary: z.string(),
              status: z.string(),
            }),
          ),
        }),
      ),
    }),
    handler: async ({ agentId: id, limit }, context) => ({
      runs: (await AgentRunService.history(context, id, limit ?? 10)).map(
        runSummary,
      ),
    }),
  }),

  get_team_agent_run: crmTool({
    description:
      "One run of a team agent in full: its steps in order (the first 200), the actions it took or tried, and how it ended.",
    risk: "read",
    input: z.object({ agentId, runId }).strict(),
    output: runOutput.extend({
      steps: z.array(
        z.object({
          type: z.string(),
          text: z.string().nullable(),
          at: z.string(),
        }),
      ),
      totalSteps: z.number(),
      actions: z.array(actionOutput),
    }),
    handler: async ({ agentId: id, runId: run }, context) => {
      const detail = await AgentRunService.runDetail(context, id, run);
      return {
        ...runSummary(detail),
        steps: detail.events.map((event) => ({
          type: event.type,
          text: stepText(event.data),
          at: event.emittedAt,
        })),
        totalSteps: detail.totalEvents,
        actions: detail.actions.map(action),
      };
    },
  }),

  run_team_agent: crmTool({
    description:
      "Run a live team agent now, as Run now does: its deployed version, with what that version was approved to do. It costs the organization credits. Returns the run's id.",
    risk: "write",
    input: z.object({ agentId }).strict(),
    output: z.object({ id: z.string() }),
    handler: async ({ agentId: id }, context) => {
      const run = await AgentRunService.runNow(context, {
        agentId: id,
        clientRequestId: crypto.randomUUID(),
      });
      pokeRuns(context.organizationId);
      return run;
    },
  }),

  retry_team_agent_run: crmTool({
    description:
      "Run an ended run again: the same version, trigger and input. The agent must be live and idle. It costs the organization credits. Returns the new run's id.",
    risk: "write",
    input: z.object({ agentId, runId }).strict(),
    output: z.object({ id: z.string() }),
    handler: async (input, context) => {
      const run = await AgentRunService.retryRun(context, {
        ...input,
        clientRequestId: crypto.randomUUID(),
      });
      pokeRuns(context.organizationId);
      return run;
    },
  }),

  cancel_team_agent_run: crmTool({
    description:
      "Stop a queued or running run. What it already did stays done. The person who started it, the agent's creator, an owner or an admin may.",
    risk: "write",
    input: z.object({ agentId, runId }).strict(),
    output: z.object({
      cancelled: z.boolean().describe("False when it had already ended."),
    }),
    handler: async (input, context) => {
      const result = await AgentRunService.cancelRun(context, input);
      // The row stopped it; this only stops it spending. The Agents SDK that
      // reaches its session loads only for this.
      if (result.cancelled && result.sessionId) {
        waitUntil(
          import("@/server/features/team-agents/runtime/dispatch")
            .then(({ stopRunSession }) =>
              stopRunSession(env, context.organizationId, input.runId),
            )
            .catch((error: unknown) => {
              console.warn(
                "[team-agents] could not reach a stopped run",
                error,
              );
            }),
        );
      }
      return result;
    },
  }),

  change_team_agent_status: crmTool({
    description:
      "Pause a live team agent, resume a paused one, archive one, or restore an archived one (to paused). Its creator, an owner or an admin may. Triggers only fire while it is live.",
    risk: "write",
    input: z
      .object({
        agentId,
        action: agentTransitionSchema.shape.action,
      })
      .strict(),
    output: statusOutput,
    handler: ({ agentId: id, action: name }, context) =>
      TeamAgentService.transition(context, id, name),
  }),

  delete_team_agent: crmTool({
    description:
      "Delete a team agent: it leaves every list, its triggers stop and its queued runs are cancelled. Its creator, an owner or an admin may. Its past runs stay.",
    risk: "destructive",
    input: z.object({ agentId }).strict(),
    output: z.object({
      id: z.string(),
      name: z.string(),
      disabledTriggers: z.number(),
      cancelledRuns: z.number(),
    }),
    handler: ({ agentId: id }, context) => TeamAgentService.remove(context, id),
  }),
};
