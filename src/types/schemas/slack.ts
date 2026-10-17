import { z } from "zod";
import { SLACK_CONNECT_ERRORS } from "@/shared/slack";

/** The Slack page's search: why the last connect came back without Slack. */
export const slackConnectSearchSchema = z.object({
  error: z.enum(SLACK_CONNECT_ERRORS).optional().catch(undefined),
});

export const slackChannelsSchema = z.object({
  query: z.string().trim().max(80).optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
});

export const slackChannelSchema = z.object({
  channelId: z.string().trim().min(1).max(64),
});

export const createSlackChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers and dashes."),
  isPrivate: z.boolean(),
});
