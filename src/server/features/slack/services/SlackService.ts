import {
  ConfigurationError,
  integrationFetch,
  integrationStatus,
} from "@every-app/sdk/server";
import { z } from "zod";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { requireOrgPermission } from "@/server/auth/org-gate";
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
  type SlackConnectError,
} from "@/shared/slack";
import {
  agentManifest,
  slackDestinationOf,
  type SlackDestination,
} from "@/shared/team-agents";
import { SlackRepository } from "../repositories/SlackRepository";
import { slackCallOrThrow, SlackError } from "../lib/slackApi";
import { SlackInventoryService, syncState } from "./SlackInventoryService";

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

const SLACK_CLIENT_SETTINGS = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"];

async function gatewayEnv(): Promise<object> {
  return (await getWorkersEnv()) ?? {};
}

/** Whether the gateway holds Slack's OAuth client, and its public id. */
async function gatewayClient(): Promise<{
  ready: boolean;
  clientId: string | null;
}> {
  try {
    const client = await integrationStatus({
      env: await gatewayEnv(),
      provider: "slack",
    });
    return { ready: client.ready, clientId: client.clientId ?? null };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { ready: false, clientId: null };
    }
    throw error;
  }
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
  // `everyapp dev` has no gateway: the developer's own client goes in
  // .dev.vars under the gateway's names. Otherwise only the operator of a
  // fork's gateway can set its secrets.
  const local = Boolean((env as { EVERYAPP_DEV?: string }).EVERYAPP_DEV);
  const base = {
    configured: client.ready,
    canManage: manage,
    setup:
      isForkDeployment(env) && (local || manage)
        ? {
            command: local
              ? null
              : `pnpm everyapp secret set ${SLACK_CLIENT_SETTINGS.join(" ")} --for gateway`,
            devVars: local ? SLACK_CLIENT_SETTINGS : null,
          }
        : null,
  };
  if (!connection) return { ...base, connected: false as const };
  const [members, agents] = await Promise.all([
    SlackRepository.listMatches(context.organizationId),
    slackAgents(context.organizationId),
  ]);
  SlackInventoryService.rematchIfChanged(connection, members);
  const scopes = scopeList(connection.botScopes);
  return {
    ...base,
    connected: true as const,
    workspace: connection.teamName,
    /** The app's name in the workspace; null until the first sync reads it. */
    appName: connection.botName,
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
 * Slack page shows ("connected", or why not).
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
): Promise<"connected" | SlackConnectError> {
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
  if (input.error)
    return input.error === "access_denied" ? "access_denied" : "rejected";
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
  SlackInventoryService.startSync(context.organizationId);
  return "connected";
}

async function disconnect(context: Context, channel: string) {
  requireHuman(channel);
  requireOrgPermission(context, { connection: ["manage"] });
  const removed = await SlackRepository.deleteConnection(
    context.organizationId,
  );
  if (!removed) throw new AppError("NOT_FOUND");
  console.log("[slack] disconnected", {
    organizationId: context.organizationId,
  });
  return { disconnected: true };
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

/** Whether the gateway holds Slack's client (the setup checklist). */
async function clientReady(): Promise<boolean> {
  return (await gatewayClient()).ready;
}

export const SlackService = {
  status,
  clientReady,
  startConnect,
  completeConnect,
  disconnect,
  isConnected,
  postMessage,
};
