import { z } from "zod";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { TEAM_AGENT_STATUSES } from "@/shared/team-agents";
import {
  createSlackChannelSchema,
  slackChannelSchema,
  slackChannelsSchema,
} from "@/types/schemas/slack";

// What the CRM knows of the connected Slack workspace: whether it is
// connected, the channels it can reach (joining and creating them) and which
// members are which Slack users, as the agent builder offers them. Connecting
// Slack is an OAuth flow for an owner or admin in the browser, so it stays in
// Settings → Connections.

const PEOPLE_PAGE = 50;

const syncOutput = z
  .enum(["idle", "syncing", "stalled"])
  .describe("Whether the CRM is reading Slack again right now.");

const channelId = slackChannelSchema.shape.channelId.describe(
  "The channel's id, from list_slack_channels.",
);

export const slackTools = {
  get_slack_status: crmTool({
    description:
      "Whether the organization's Slack workspace is connected: its name, the CRM's app name in it (what /invite @… takes), permissions it lacks, when the CRM last read its people and channels, how many members matched a Slack user, and the deployed agents that post to it.",
    risk: "read",
    input: z.object({}).strict(),
    output: z.object({
      available: z
        .boolean()
        .describe(
          "This CRM can connect Slack: an owner or admin does it in Settings → Connections.",
        ),
      connected: z.boolean(),
      workspace: z.string().nullable(),
      appName: z.string().nullable(),
      connectedAt: z.string().nullable(),
      missingScopes: z
        .array(z.string())
        .describe("Permissions the app lacks; connecting again grants them."),
      canInviteItself: z
        .boolean()
        .describe(
          "The app can join private channels without someone in them inviting it.",
        ),
      sync: syncOutput,
      syncedAt: z.string().nullable(),
      syncError: z.string().nullable(),
      people: z
        .object({ matched: z.number(), total: z.number() })
        .nullable()
        .describe("Members matched to a Slack user by email, of all members."),
      agents: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.enum(TEAM_AGENT_STATUSES),
          destination: z.string().describe("Where it posts."),
        }),
      ),
    }),
    handler: async (_input, context) => {
      const status = await SlackService.status(context);
      const base = { available: status.configured };
      if (!status.connected) {
        return {
          ...base,
          connected: false,
          workspace: null,
          appName: null,
          connectedAt: null,
          missingScopes: [],
          canInviteItself: false,
          sync: "idle" as const,
          syncedAt: null,
          syncError: null,
          people: null,
          agents: [],
        };
      }
      return { ...base, ...status, missingScopes: status.missing };
    },
  }),

  list_slack_channels: crmTool({
    description:
      "The connected Slack workspace's channels the CRM can reach: name, members, private or not, and whether its app is in it. `query` matches part of the name. 50 a page; pass nextOffset for more.",
    risk: "read",
    input: z
      .object({
        query: slackChannelsSchema.shape.query.describe(
          "Part of a channel's name.",
        ),
        offset: z
          .number()
          .int()
          .min(0)
          .max(10_000)
          .optional()
          .describe("The nextOffset of the page before."),
      })
      .strict(),
    output: z.object({
      sync: syncOutput,
      channels: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          memberCount: z.number().nullable(),
          isPrivate: z.boolean(),
          isMember: z.boolean().describe("The CRM's app is in the channel."),
          classified: z
            .boolean()
            .describe("Slack has confirmed isPrivate and isMember."),
          inviteRequestedAt: z
            .string()
            .nullable()
            .describe(
              "When a join asked someone in this private channel to /invite the app.",
            ),
        }),
      ),
      nextOffset: z.number().nullable(),
    }),
    handler: async ({ query, offset }, context) => {
      const page = await SlackInventoryService.channels(context, {
        query,
        offset: offset ?? 0,
      });
      return { ...page, channels: page.rows };
    },
  }),

  join_slack_channel: crmTool({
    description:
      "Put the CRM's app in a Slack channel, so agents can post there (owners and admins only). A public channel it joins itself; a private one it is invited to when Slack allows, else `asked`: someone in the channel must /invite the app (get_slack_status gives its name).",
    risk: "write",
    input: z.object({ channelId }).strict(),
    output: z.object({
      outcome: z.enum(["joined", "already", "asked", "failed"]),
      reason: z.string().nullable().describe("Why it failed."),
    }),
    handler: async ({ channelId: id }, context) => {
      const joined = await SlackInventoryService.joinChannel(context, id);
      return {
        outcome: joined.outcome,
        reason: joined.outcome === "failed" ? joined.reason : null,
      };
    },
  }),

  create_slack_channel: crmTool({
    description:
      "Create a Slack channel with the CRM's app in it (owners and admins only). A private one needs the installer's permission, which get_slack_status's canInviteItself says it has.",
    risk: "write",
    input: z
      .object({
        name: createSlackChannelSchema.shape.name.describe(
          "Lowercase letters, numbers, dashes and underscores, like deal-alerts.",
        ),
        isPrivate: z.boolean().optional(),
      })
      .strict(),
    output: z.object({
      created: z.boolean(),
      channel: z.object({ id: z.string(), name: z.string() }).nullable(),
      reason: z.string().nullable().describe("Why it wasn't created."),
    }),
    handler: async ({ name, isPrivate }, context) => {
      const result = await SlackInventoryService.createChannel(context, {
        name,
        isPrivate: isPrivate ?? false,
      });
      return result.created
        ? { created: true, channel: result.channel, reason: null }
        : { created: false, channel: null, reason: result.reason };
    },
  }),

  refresh_slack: crmTool({
    description:
      "Read Slack's people and channels again, in the background: members are matched to Slack users by email and the channel list is replaced. The list tools' `sync` says when it is done.",
    risk: "write",
    input: z.object({}).strict(),
    output: z.object({ requested: z.boolean() }),
    handler: async (_input, context) => {
      await SlackInventoryService.refresh(context);
      return { requested: true };
    },
  }),

  list_slack_people: crmTool({
    description:
      "The organization's members and the Slack user each is, matched by exact email. Members not checked yet are matched in the background, and `sync` says when that is done. 50 a page, by name.",
    risk: "read",
    input: z.object({ page: pageInput }).strict(),
    output: z.object({
      sync: syncOutput,
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      people: z.array(
        z.object({
          name: z.string(),
          email: z.string(),
          reviewed: z
            .boolean()
            .describe("The CRM has looked for them in Slack."),
          slackUserId: z
            .string()
            .nullable()
            .describe(
              "Null until they are reviewed, and after when no Slack user has their email.",
            ),
          slackHandle: z.string().nullable(),
        }),
      ),
    }),
    handler: async ({ page }, context) => {
      const { sync, rows } = await SlackInventoryService.matches(context);
      const { rows: people, ...rest } = pageOf(rows, page ?? 1, PEOPLE_PAGE);
      return { sync, ...rest, people };
    },
  }),
};
