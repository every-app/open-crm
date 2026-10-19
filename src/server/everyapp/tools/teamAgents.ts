import { z } from "zod";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { TeamAgentService } from "@/server/features/team-agents/services/TeamAgentService";
import { AppError } from "@/server/lib/errors";
import { TEAM_AGENT_STATUSES, TRIGGER_TYPES } from "@/shared/team-agents";
import { agentTransitionSchema } from "@/types/schemas/team-agents";

// Team agents for AI clients: see them, their versions, files and audit log;
// rename, pause, resume, archive, restore and delete them (their runs are in
// teamAgentRuns.ts). Building and deploying a version stays with people in the
// CRM: deploying is where a person approves what a version may read and do.

export const agentId = z
  .string()
  .min(1)
  .describe("The agent's id, from list_team_agents.");

const AGENTS_PAGE = 50;

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
      .array(
        z.object({
          type: z.string(),
          summary: z.string(),
          destination: z
            .object({
              kind: z.enum(["channel", "user"]),
              id: z.string(),
              label: z.string(),
            })
            .optional()
            .describe("The one Slack channel or person it may post to."),
          activityTypes: z
            .array(z.enum(["NOTE", "TASK"]))
            .optional()
            .describe("What it may write on a record."),
        }),
      )
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

/** The version get_team_agent shows: the deployed one, else the one in review. */
async function shownVersionId(
  context: Parameters<typeof TeamAgentService.get>[0],
  id: string,
): Promise<string> {
  const agent = await TeamAgentService.get(context, id);
  const shown = agent.currentVersion ?? agent.reviewVersion;
  if (!shown) {
    throw new AppError("NOT_FOUND", "This agent has no saved version yet.");
  }
  return shown.id;
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
          triggers: z
            .array(
              z.object({
                type: z.enum(TRIGGER_TYPES),
                name: z.string(),
                nextRunAt: z.string().nullable(),
              }),
            )
            .describe("Its enabled triggers."),
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

  list_team_agent_activity: crmTool({
    description:
      "A team agent's audit log, newest first: who deployed, paused, renamed or ran it and when, with what changed. 20 unless `limit` says (at most 100).",
    risk: "read",
    input: z
      .object({
        agentId,
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    output: z.object({
      events: z.array(
        z.object({
          type: z.string(),
          summary: z.string(),
          actor: z.object({
            type: z.string().describe("USER, AGENT or SYSTEM."),
            name: z.string().nullable(),
          }),
          version: z.number().nullable(),
          before: z.unknown(),
          after: z.unknown(),
          at: z.string(),
        }),
      ),
    }),
    handler: async ({ agentId: id, limit }, context) => ({
      events: (await TeamAgentService.activity(context, id, limit ?? 20)).map(
        (event) => ({
          ...event,
          actor: { type: event.actorType, name: event.actorName },
          version: event.versionNumber,
          at: event.emittedAt,
        }),
      ),
    }),
  }),

  get_team_agent_files: crmTool({
    description:
      "A team agent version's files, exactly as saved: README.md, instructions.md (what it is told to do) and manifest.json (what it may read and do). The deployed version unless versionId names another, such as get_team_agent's reviewVersion.",
    risk: "read",
    input: z
      .object({
        agentId,
        versionId: z
          .string()
          .min(1)
          .optional()
          .describe("A version's id, from get_team_agent."),
      })
      .strict(),
    output: z.object({
      versionId: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() })),
    }),
    handler: async ({ agentId: id, versionId }, context) => {
      const shown = versionId ?? (await shownVersionId(context, id));
      return TeamAgentService.files(context, id, shown);
    },
  }),

  rename_team_agent: crmTool({
    description:
      "Rename a team agent, or change its description (null clears it). Its creator, an owner or an admin may. Deploying a version later takes that version's name.",
    risk: "write",
    input: z
      .object({
        agentId,
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(320).nullable().optional(),
      })
      .strict(),
    output: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      status: z.enum(TEAM_AGENT_STATUSES),
    }),
    handler: ({ agentId: id, ...input }, context) =>
      TeamAgentService.rename(context, id, input),
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
