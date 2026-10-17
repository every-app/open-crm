import {
  ConfigurationError,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { TeamAgentRepository } from "@/server/features/team-agents/repositories/TeamAgentRepository";
import { isForkDeployment } from "@/server/lib/deployment-tier";
import { AppError } from "@/server/lib/errors";
import { gatewayCallFor } from "@/server/lib/gateway-attribution";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { hasOrgPermission } from "@/shared/org-permissions";
import {
  missingSlackScopes,
  scopeList,
  SLACK_BOT_SCOPES,
  SLACK_REDIRECT_PATH,
  SLACK_USER_SCOPES,
} from "@/shared/slack";
import {
  agentManifest,
  slackDestinationOf,
  type SlackDestination,
} from "@/shared/team-agents";
import {
  SlackRepository,
  type SlackConnectionRow,
} from "../repositories/SlackRepository";
import {
  explainSlackError,
  slackCall,
  slackCallOrThrow,
  slackPages,
  SlackError,
} from "../lib/slackApi";

// The workspace's Slack, ported from the CRM's Slack connection (packages/
// auth slack-*, apps/api/src/slack, the agent's slack-*.ts). Owners and
// admins connect it through the Every App gateway's `slack` OAuth client: the
// gateway completes Slack's token endpoint with its client, and the CRM keeps
// the tokens Slack issues in its own database and calls Slack's API with
// them. Tokens never leave this module's callers on the server: no client,
// log, model or MCP tool sees one.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const STATE_TTL_MS = 10 * 60_000;
const SYNC_STALLED_MS = 3 * 60_000;
const INVENTORY_STALE_MS = 15 * 60_000;
const CHANNEL_PAGE = 50;

export const SLACK_GATEWAY_COMMAND =
  "everyapp secret set SLACK_CLIENT_ID SLACK_CLIENT_SECRET --for gateway";

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/** Whether the gateway holds Slack's OAuth client, and its public id. */
async function gatewayClient(): Promise<{ ready: boolean; clientId: string | null }> {
  try {
    const status = await integrationStatus({
      env: await gatewayEnv(),
      provider: "slack",
    });
    return { ready: status.ready, clientId: status.clientId ?? null };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { ready: false, clientId: null };
    }
    throw error;
  }
}

type SyncState = "idle" | "syncing" | "stalled";

function syncState(connection: SlackConnectionRow): SyncState {
  const started = connection.syncStartedAt;
  if (!started || (connection.syncedAt && connection.syncedAt >= started)) {
    return "idle";
  }
  return Date.now() - Date.parse(started) < SYNC_STALLED_MS
    ? "syncing"
    : "stalled";
}

function canManage(context: Pick<Context, "role">): boolean {
  return hasOrgPermission(context.role, { connection: ["manage"] });
}

/** The Slack card: set up on the gateway, connected, what it granted. */
async function status(context: Context) {
  const [client, connection, env] = await Promise.all([
    gatewayClient(),
    SlackRepository.getConnection(context.organizationId),
    gatewayEnv(),
  ]);
  const manage = canManage(context);
  const base = {
    configured: client.ready,
    canManage: manage,
    // Only the operator of a fork's gateway can set its secrets.
    setupCommand: manage && isForkDeployment(env) ? SLACK_GATEWAY_COMMAND : null,
  };
  if (!connection) return { ...base, connected: false as const };
  const [members, agents] = await Promise.all([
    SlackRepository.listMatches(context.organizationId),
    slackAgents(context.organizationId),
  ]);
  const scopes = scopeList(connection.botScopes);
  return {
    ...base,
    connected: true as const,
    workspace: connection.teamName,
    connectedAt: connection.connectedAt,
    scopes,
    missing: missingSlackScopes(scopes).map((entry) => entry.scope),
    canInviteItself: Boolean(connection.userToken),
    sync: syncState(connection),
    syncedAt: connection.syncedAt,
    syncError: connection.syncError,
    agents,
    people: {
      matched: members.filter((row) => row.slackUserId).length,
      reviewed: members.filter((row) => row.reviewedAt).length,
      total: members.length,
    },
  };
}

/** Deployed agents that post to Slack, for the Slack card. */
async function slackAgents(organizationId: string) {
  const rows = await TeamAgentRepository.slackAgents(organizationId);
  return rows.flatMap((row) => {
    const manifest = agentManifest.safeParse(row.manifest);
    const destination = manifest.success
      ? slackDestinationOf(manifest.data)
      : null;
    return destination
      ? [
          {
            id: row.id,
            name: row.name,
            description: row.description,
            status: row.status,
            destination: destination.label,
          },
        ]
      : [];
  });
}

function requireHuman(channel: string): void {
  // The gateway refuses an agent's token exchange too; nothing here starts
  // one for an agent either.
  if (channel === "mcp") throw new AppError("FORBIDDEN");
}

/**
 * Starts connecting: the Slack authorize URL, with a one-use state for this
 * person. Owners and admins only, from a person's browser.
 */
async function startConnect(
  context: Context,
  input: { origin: string; channel: string },
): Promise<{ url: string }> {
  requireHuman(input.channel);
  requireOrgPermission(context, { connection: ["manage"] });
  const client = await gatewayClient();
  if (!client.ready || !client.clientId) {
    throw new AppError(
      "SLACK_UNAVAILABLE",
      "The gateway holds no Slack OAuth client.",
    );
  }
  const state = await SlackRepository.insertState(
    context.organizationId,
    context.userId,
  );
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("user_scope", SLACK_USER_SCOPES.join(","));
  url.searchParams.set("redirect_uri", `${input.origin}${SLACK_REDIRECT_PATH}`);
  url.searchParams.set("state", state);
  return { url: url.toString() };
}

const tokenReply = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  scope: z.string().catch(""),
  bot_user_id: z.string().nullish().catch(null),
  team: z.object({ id: z.string().min(1), name: z.string().nullish() }),
  authed_user: z
    .object({
      access_token: z.string().nullish(),
      scope: z.string().nullish(),
    })
    .nullish()
    .catch(null),
});

const tokenError = z
  .object({ error: z.string().catch("rejected") })
  .catch({ error: "rejected" });

/**
 * Finishes connecting on Slack's redirect back: checks the state was minted
 * for this person minutes ago, has the gateway complete Slack's token
 * endpoint with its client, and keeps the tokens. The outcome code the
 * settings page shows ("connected", or why not).
 */
async function completeConnect(
  context: Context,
  input: {
    channel: string;
    origin: string;
    code: string | null;
    state: string | null;
    error: string | null;
  },
): Promise<string> {
  requireHuman(input.channel);
  if (!canManage(context)) return "forbidden";
  if (!input.state) return "invalid_state";
  const fresh = await SlackRepository.consumeState(
    context.organizationId,
    context.userId,
    input.state,
    new Date(Date.now() - STATE_TTL_MS).toISOString(),
  );
  if (!fresh) return "invalid_state";
  if (input.error) return input.error === "access_denied" ? "access_denied" : "rejected";
  if (!input.code) return "rejected";
  const env = await gatewayEnv();
  let response: Response;
  try {
    const slack = integrationFetch({
      env,
      provider: "slack",
      for: gatewayCallFor(env),
    });
    response = await slack(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        redirect_uri: `${input.origin}${SLACK_REDIRECT_PATH}`,
      }),
    });
  } catch (error) {
    if (error instanceof ConfigurationError) return "not_configured";
    throw error;
  }
  const body: unknown = await response.json().catch(() => null);
  const granted = tokenReply.safeParse(body);
  if (!granted.success) {
    console.warn("[slack] connect refused", {
      organizationId: context.organizationId,
      status: response.status,
      reason: tokenError.parse(body).error,
    });
    return "exchange_failed";
  }
  const { data } = granted;
  await SlackRepository.saveConnection({
    organizationId: context.organizationId,
    teamId: data.team.id,
    teamName: data.team.name ?? null,
    botUserId: data.bot_user_id ?? null,
    botToken: data.access_token,
    botScopes: data.scope,
    userToken: data.authed_user?.access_token ?? null,
    userScopes: data.authed_user?.scope ?? null,
    connectedById: context.userId,
  });
  console.log("[slack] connected", {
    organizationId: context.organizationId,
    teamId: data.team.id,
  });
  startSync(context.organizationId);
  return "connected";
}

async function disconnect(context: Context, channel: string) {
  requireHuman(channel);
  requireOrgPermission(context, { connection: ["manage"] });
  const removed = await SlackRepository.deleteConnection(context.organizationId);
  if (!removed) throw new AppError("NOT_FOUND");
  console.log("[slack] disconnected", { organizationId: context.organizationId });
  return { disconnected: true };
}

async function requireConnection(
  organizationId: string,
): Promise<SlackConnectionRow> {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) throw new AppError("SLACK_UNAVAILABLE");
  return connection;
}

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
    nextOffset:
      rows.length > CHANNEL_PAGE ? input.offset + CHANNEL_PAGE : null,
  };
}

function pickerChannel(row: Awaited<ReturnType<typeof SlackRepository.findChannel>> & {}) {
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
  const channel = await SlackRepository.findChannel(organizationId, slackChannelId);
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
    return { outcome: "failed", reason: explainSlackError(reply.error ?? "rejected") };
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
    const [people, botChannels, userChannels, members] = await Promise.all([
      slackPages(bot, "users.list", "members", slackMember),
      slackPages(bot, "conversations.list", "channels", slackChannelItem, channelQuery),
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
    const matches = members.map((row) => {
      const slack = byEmail.get(row.email.trim().toLowerCase());
      return {
        userId: row.userId,
        slackUserId: slack?.id ?? null,
        slackHandle: slack ? `@${slack.name ?? slack.id}` : null,
        slackEmail: slack?.profile?.email ?? null,
      };
    });
    await SlackRepository.saveMatches(organizationId, matches);
    const seen = new Map(botChannels.map((channel) => [channel.id, channel]));
    for (const channel of userChannels) {
      if (!seen.has(channel.id)) seen.set(channel.id, { ...channel, is_member: false });
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
    });
    const matched = matches.filter((match) => match.slackUserId).length;
    return `Matched ${matched} of ${matches.length} members by email and found ${available.length} available channels.`;
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
  const connection = await SlackRepository.getConnection(context.organizationId);
  const rows = await SlackRepository.listMatches(context.organizationId);
  return {
    sync: connection ? syncState(connection) : ("idle" as const),
    rows: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
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

/** Whether the organization has a Slack workspace connected. */
async function isConnected(organizationId: string): Promise<boolean> {
  return (await SlackRepository.getConnection(organizationId)) !== null;
}

const openedConversation = z.object({
  channel: z.object({ id: z.string().min(1) }),
});

const postedMessage = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1),
});

/**
 * Posts `text` to the destination a version approved, ported from the CRM's
 * sendSlackMessage. A person is reached through a direct message the app
 * opens. `beforePost` runs just before the message is sent and throws to
 * stop it (the run was cancelled meanwhile).
 */
async function postMessage(
  organizationId: string,
  destination: SlackDestination,
  text: string,
  clientMessageId: string,
  beforePost: () => Promise<void>,
): Promise<{ channel: string; ts: string }> {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) throw new SlackError("not_connected");
  const token = connection.botToken;
  let channel = destination.id;
  if (destination.kind === "user") {
    const opened = openedConversation.safeParse(
      await slackCallOrThrow(token, "conversations.open", {
        body: { users: destination.id, return_im: true },
      }),
    );
    if (!opened.success) throw new SlackError("unreadable_reply");
    channel = opened.data.channel.id;
  }
  await beforePost();
  const posted = postedMessage.safeParse(
    await slackCallOrThrow(token, "chat.postMessage", {
      body: { channel, text, client_msg_id: clientMessageId },
    }),
  );
  if (!posted.success) throw new SlackError("unreadable_reply");
  return posted.data;
}

export const SlackService = {
  status,
  startConnect,
  completeConnect,
  disconnect,
  channels,
  joinChannel,
  createChannel,
  refresh,
  sync,
  matches,
  builderInventory,
  isConnected,
  postMessage,
};
