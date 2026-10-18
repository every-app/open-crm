import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError } from "@/server/lib/errors";
import {
  SlackRepository,
  type SlackConnectionRow,
} from "../repositories/SlackRepository";
import {
  explainSlackError,
  slackCall,
  slackPages,
  SlackError,
} from "../lib/slackApi";

// What the CRM knows of the connected Slack workspace, ported from the CRM's
// slack-people.ts and slack-membership.ts: the channels the app can reach
// (joining and creating them), and which members are which Slack users,
// matched by exact email. The agent builder pins destinations to this
// inventory.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const SYNC_STALLED_MS = 3 * 60_000;

type SyncState = "idle" | "syncing" | "stalled";

export function syncState(connection: SlackConnectionRow): SyncState {
  const started = connection.syncStartedAt;
  if (!started || (connection.syncedAt && connection.syncedAt >= started)) {
    return "idle";
  }
  return Date.now() - Date.parse(started) < SYNC_STALLED_MS
    ? "syncing"
    : "stalled";
}

async function requireConnection(
  organizationId: string,
): Promise<SlackConnectionRow> {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) throw new AppError("SLACK_UNAVAILABLE");
  return connection;
}

const channelInfo = z
  .object({
    channel: z
      .object({
        is_private: z.boolean().optional(),
        is_member: z.boolean().optional(),
      })
      .nullish(),
  })
  .catch({ channel: null });

const INVENTORY_STALE_MS = 15 * 60_000;

const CHANNEL_PAGE = 50;

/** A page of the channels the app can reach. */
async function channels(
  context: Context,
  input: { query?: string; offset: number },
) {
  const connection = await requireConnection(context.organizationId);
  const rows = await SlackRepository.listChannels(context.organizationId, {
    query: input.query,
    limit: CHANNEL_PAGE + 1,
    offset: input.offset,
  });
  return {
    canInviteItself: Boolean(connection.userToken),
    sync: syncState(connection),
    rows: rows.slice(0, CHANNEL_PAGE).map(pickerChannel),
    nextOffset: rows.length > CHANNEL_PAGE ? input.offset + CHANNEL_PAGE : null,
  };
}

function pickerChannel(
  row: Awaited<ReturnType<typeof SlackRepository.findChannel>> & {},
) {
  return {
    id: row.slackChannelId,
    name: row.name,
    memberCount: row.memberCount,
    isPrivate: row.isPrivate,
    isMember: row.isMember,
    classified: row.classifiedAt !== null,
    inviteRequestedAt: row.inviteRequestedAt,
  };
}

type JoinOutcome =
  | { outcome: "joined" | "already" | "asked" }
  | { outcome: "failed"; reason: string };

/**
 * Puts the app in a channel: a public one it joins itself; a private one it
 * is invited to with the installer's token, or, without that grant, the
 * channel is marked as waiting on someone inside to invite it.
 */
async function joinChannel(
  context: Context,
  slackChannelId: string,
): Promise<JoinOutcome> {
  const { organizationId } = context;
  const connection = await requireConnection(organizationId);
  const channel = await SlackRepository.findChannel(
    organizationId,
    slackChannelId,
  );
  if (!channel) throw new AppError("NOT_FOUND");
  const bot = connection.botToken;
  const live = await slackCall(bot, "conversations.info", {
    query: { channel: slackChannelId },
  });
  const info = channelInfo.parse(live.body).channel;
  const state = live.ok
    ? {
        isPrivate: info?.is_private ?? false,
        isMember: info?.is_member ?? false,
      }
    : live.error === "channel_not_found"
      ? { isPrivate: true, isMember: false }
      : { isPrivate: channel.isPrivate, isMember: channel.isMember };
  if (state.isMember) {
    await SlackRepository.updateChannel(organizationId, slackChannelId, {
      ...state,
      classifiedAt: new Date().toISOString(),
    });
    return { outcome: "already" };
  }
  if (state.isPrivate && !connection.userToken) {
    await SlackRepository.updateChannel(organizationId, slackChannelId, {
      ...state,
      inviteRequestedAt: new Date().toISOString(),
    });
    return { outcome: "asked" };
  }
  const reply =
    state.isPrivate && connection.userToken
      ? connection.botUserId
        ? await slackCall(connection.userToken, "conversations.invite", {
            body: { channel: slackChannelId, users: connection.botUserId },
          })
        : { ok: false, error: "unknown_bot_user" }
      : await slackCall(bot, "conversations.join", {
          body: { channel: slackChannelId },
        });
  if (!reply.ok && reply.error !== "already_in_channel") {
    return {
      outcome: "failed",
      reason: explainSlackError(reply.error ?? "rejected"),
    };
  }
  await SlackRepository.updateChannel(organizationId, slackChannelId, {
    isPrivate: state.isPrivate,
    isMember: true,
    inviteRequestedAt: null,
    classifiedAt: new Date().toISOString(),
  });
  return { outcome: reply.ok ? "joined" : "already" };
}

const createdChannel = z.object({
  channel: z.object({ id: z.string().min(1), name: z.string().min(1) }),
});

/** Creates a channel in Slack and puts the app in it. */
async function createChannel(
  context: Context,
  input: { name: string; isPrivate: boolean },
): Promise<
  | { created: true; channel: { id: string; name: string } }
  | { created: false; reason: string }
> {
  const { organizationId } = context;
  const connection = await requireConnection(organizationId);
  if (await SlackRepository.findChannelByName(organizationId, input.name)) {
    return { created: false, reason: explainSlackError("name_taken") };
  }
  const token = input.isPrivate
    ? connection.userToken
    : (connection.userToken ?? connection.botToken);
  if (!token) {
    return { created: false, reason: explainSlackError("no_user_grant") };
  }
  const reply = await slackCall(token, "conversations.create", {
    body: { name: input.name, is_private: input.isPrivate },
  });
  const parsed = createdChannel.safeParse(reply.body);
  if (!reply.ok || !parsed.success) {
    return {
      created: false,
      reason: explainSlackError(reply.error ?? "unreadable_reply"),
    };
  }
  const { channel } = parsed.data;
  const madeByBot = token === connection.botToken;
  await SlackRepository.upsertChannel(organizationId, {
    slackChannelId: channel.id,
    name: channel.name,
    memberCount: null,
    isPrivate: input.isPrivate,
    isMember: madeByBot,
  });
  if (!madeByBot) await joinChannel(context, channel.id);
  return { created: true, channel };
}

/** Reads Slack's people and channels again, after the response. */
async function refresh(context: Context) {
  await requireConnection(context.organizationId);
  startSync(context.organizationId);
  return { requested: true };
}

function startSync(organizationId: string): void {
  waitUntil(
    sync(organizationId).catch((error: unknown) => {
      console.error("[slack] sync failed", { organizationId }, error);
    }),
  );
}

const slackMember = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  deleted: z.boolean().optional(),
  is_bot: z.boolean().optional(),
  profile: z.object({ email: z.string().nullish() }).nullish(),
});

const slackChannelItem = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  num_members: z.number().int().nonnegative().nullish(),
  is_member: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  is_private: z.boolean().optional(),
});

const authTest = z
  .object({ user: z.string().nullish(), bot_id: z.string().nullish() })
  .catch({ user: null, bot_id: null });

const botInfo = z
  .object({ bot: z.object({ name: z.string().min(1) }).nullish() })
  .catch({ bot: null });

/**
 * The app's name in the workspace, which `/invite @…` takes: its bot's
 * name, or the bot user's when Slack won't give that. Null when Slack won't
 * say at all.
 */
async function appName(token: string): Promise<string | null> {
  const self = await slackCall(token, "auth.test");
  if (!self.ok) return null;
  const { user, bot_id: botId } = authTest.parse(self.body);
  if (botId) {
    const info = await slackCall(token, "bots.info", { query: { bot: botId } });
    const name = info.ok ? botInfo.parse(info.body).bot?.name : null;
    if (name) return name;
  }
  return user ?? null;
}

/**
 * Matches every member to a Slack user by exact email, and replaces the
 * channel inventory with what the app (and, with the installer's grant, the
 * installer) can see. Ported from the CRM's runSlackPeopleMatch.
 */
async function sync(organizationId: string): Promise<string> {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) return "Slack is not connected.";
  await SlackRepository.markSync(organizationId, {
    syncStartedAt: new Date().toISOString(),
  });
  try {
    const bot = connection.botToken;
    const channelQuery = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
    };
    const [name, people, botChannels, userChannels, members] =
      await Promise.all([
        // Display-only: a failed lookup keeps the name read last time.
        appName(bot).catch(() => null),
        slackPages(bot, "users.list", "members", slackMember),
        slackPages(
          bot,
          "conversations.list",
          "channels",
          slackChannelItem,
          channelQuery,
        ),
        connection.userToken
          ? slackPages(
              connection.userToken,
              "conversations.list",
              "channels",
              slackChannelItem,
              channelQuery,
            ).catch(() => [])
          : Promise.resolve([]),
        AuthRepository.listMembers(organizationId),
      ]);
    const byEmail = new Map(
      people
        .filter((person) => !person.deleted && !person.is_bot)
        .flatMap((person) => {
          const email = person.profile?.email?.trim().toLowerCase();
          return email ? [[email, person] as const] : [];
        }),
    );
    const memberMatches = members.map((row) => {
      const slack = byEmail.get(row.email.trim().toLowerCase());
      return {
        userId: row.userId,
        slackUserId: slack?.id ?? null,
        slackHandle: slack ? `@${slack.name ?? slack.id}` : null,
        slackEmail: slack?.profile?.email ?? null,
      };
    });
    await SlackRepository.saveMatches(organizationId, memberMatches);
    const seen = new Map(botChannels.map((channel) => [channel.id, channel]));
    for (const channel of userChannels) {
      if (!seen.has(channel.id))
        seen.set(channel.id, { ...channel, is_member: false });
    }
    const canInviteItself = Boolean(connection.userToken);
    const available = [...seen.values()].filter(
      (channel) =>
        !channel.is_archived &&
        (channel.is_member || !channel.is_private || canInviteItself),
    );
    await SlackRepository.replaceChannels(
      organizationId,
      available.map((channel) => ({
        slackChannelId: channel.id,
        name: channel.name,
        memberCount: channel.num_members ?? null,
        isPrivate: channel.is_private ?? false,
        isMember: channel.is_member ?? false,
      })),
    );
    await SlackRepository.markSync(organizationId, {
      syncedAt: new Date().toISOString(),
      syncError: null,
      ...(name ? { botName: name } : {}),
    });
    const matched = memberMatches.filter((match) => match.slackUserId).length;
    return `Matched ${matched} of ${memberMatches.length} members by email and found ${available.length} available channels.`;
  } catch (error) {
    const reason =
      error instanceof SlackError
        ? error.message
        : "Slack could not be read. Try again in a moment.";
    await SlackRepository.markSync(organizationId, {
      syncedAt: new Date().toISOString(),
      syncError: reason,
    });
    throw error;
  }
}

/** Members and the Slack users they matched. */
async function matches(context: Context) {
  const connection = await SlackRepository.getConnection(
    context.organizationId,
  );
  const rows = await SlackRepository.listMatches(context.organizationId);
  return {
    sync: connection ? syncState(connection) : ("idle" as const),
    rows: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      slackUserId: row.slackUserId,
      slackHandle: row.slackHandle,
      reviewed: row.reviewedAt !== null,
    })),
  };
}

/**
 * What the agent builder may pin a Slack destination to: whether Slack is
 * connected, the channels the app can reach, and members matched to a Slack
 * user. An inventory older than a quarter of an hour is read again.
 */
async function builderInventory(organizationId: string) {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) {
    return { connected: false, channels: [], people: [] };
  }
  const stale =
    syncState(connection) === "idle" &&
    (!connection.syncedAt ||
      Date.now() - Date.parse(connection.syncedAt) > INVENTORY_STALE_MS);
  if (stale) startSync(organizationId);
  const [channelRows, people] = await Promise.all([
    SlackRepository.listChannels(organizationId, { limit: 100, offset: 0 }),
    SlackRepository.listMatches(organizationId),
  ]);
  return {
    connected: true,
    channels: channelRows.map((row) => ({
      id: row.slackChannelId,
      label: `#${row.name}`,
      memberCount: row.memberCount,
      isMember: row.isMember,
      isPrivate: row.isPrivate,
    })),
    people: people.flatMap((row) =>
      row.slackUserId && row.slackHandle
        ? [
            {
              id: row.slackUserId,
              label: row.slackHandle,
              name: row.name,
              email: row.email,
            },
          ]
        : [],
    ),
  };
}

export const SlackInventoryService = {
  channels,
  joinChannel,
  createChannel,
  refresh,
  sync,
  matches,
  builderInventory,
  startSync,
};
