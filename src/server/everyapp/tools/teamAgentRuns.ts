import { env, waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import { agentId } from "@/server/everyapp/tools/teamAgents";
import { pokeRuns } from "@/server/features/team-agents/runtime/poke";
import { AgentRunService } from "@/server/features/team-agents/services/AgentRunService";
import { RUN_STATUSES, TRIGGER_TYPES } from "@/shared/team-agents";

// A team agent's runs for AI clients: its history page by page and one run's
// steps; running it now, retrying a run and stopping one.

const runId = z
  .string()
  .min(1)
  .describe("The run's id, from get_team_agent_runs.");

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

export const teamAgentRunTools = {
  get_team_agent_runs: crmTool({
    description:
      "A team agent's runs, newest first: status, trigger, summary or failure, tokens and cost, and the actions each took. 10 a page unless `limit` says (at most 100); pass nextCursor for older runs. get_team_agent_run gives one run's steps.",
    risk: "read",
    input: z
      .object({
        agentId,
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z
          .string()
          .max(200)
          .regex(/^[^|]+\|[^|]+$/)
          .optional()
          .describe("The nextCursor of the page before."),
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
      nextCursor: z.string().nullable(),
    }),
    handler: async ({ agentId: id, limit = 10, cursor }, context) => {
      // One more than the page says whether there is another.
      const runs = await AgentRunService.history(
        context,
        id,
        limit + 1,
        cursor,
      );
      const page = runs.slice(0, limit);
      const last = page.at(-1);
      return {
        runs: page.map(runSummary),
        nextCursor:
          runs.length > limit && last ? `${last.createdAt}|${last.id}` : null,
      };
    },
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
};
