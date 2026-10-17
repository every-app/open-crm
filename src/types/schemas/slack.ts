import { z } from "zod";

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
