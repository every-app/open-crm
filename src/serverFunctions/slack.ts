import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callerChannel } from "@/server/features/slack/routes/callback";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  createSlackChannelSchema,
  slackChannelSchema,
  slackChannelsSchema,
} from "@/types/schemas/slack";

// Settings → Connections → Slack. Connecting and disconnecting are an owner's
// or admin's, from their own browser; the rest any member may see.

export const getSlackStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => SlackService.status(context));

export const startSlackConnect = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const request = getRequest();
    return SlackService.startConnect(context, {
      origin: new URL(request.url).origin,
      channel: await callerChannel(request.headers),
    });
  });

export const disconnectSlack = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    SlackService.disconnect(context, await callerChannel(getRequest().headers)),
  );

export const listSlackChannels = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(slackChannelsSchema)
  .handler(async ({ data, context }) => SlackService.channels(context, data));

export const joinSlackChannel = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(slackChannelSchema)
  .handler(async ({ data, context }) =>
    SlackService.joinChannel(context, data.channelId),
  );

export const createSlackChannel = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createSlackChannelSchema)
  .handler(async ({ data, context }) =>
    SlackService.createChannel(context, data),
  );

export const refreshSlack = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => SlackService.refresh(context));

export const getSlackMatches = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => SlackService.matches(context));
