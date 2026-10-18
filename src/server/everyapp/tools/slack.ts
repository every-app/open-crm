import { z } from "zod";
import { crmTool, pageInput, pageOf } from "@/server/everyapp/crm-tool";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { slackChannelsSchema } from "@/types/schemas/slack";

// What the CRM knows of the connected Slack workspace: the channels it can
// reach and which members are which Slack users, as the agent builder
// offers them. Connecting Slack is an OAuth flow for an owner or admin in
// the browser, so it stays in Settings → Connections.

const PEOPLE_PAGE = 50;

const syncOutput = z
  .enum(["idle", "syncing", "stalled"])
  .describe("Whether the CRM is reading Slack again right now.");

export const slackTools = {
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

  list_slack_people: crmTool({
    description:
      "The organization's members and the Slack user each is, matched by exact email (null when no Slack user has their email). 50 a page, by name.",
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
