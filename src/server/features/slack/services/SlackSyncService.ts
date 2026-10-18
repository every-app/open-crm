import { z } from "zod";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { slackCall, slackPage, SlackError } from "../lib/slackApi";
import {
  SlackRepository,
  type SlackConnectionRow,
} from "../repositories/SlackRepository";

// Reading the connected Slack workspace into the CRM's inventory, ported from
// the CRM's runSlackPeopleMatch: members matched to Slack users by exact
// email, and the channels the app (and, with the installer's grant, the
// installer) can see. The CRM ran it as a leased, retried task
// (slack-people-match); here it is the dispatcher's slack-sync task
// (agent/dispatch.ts). It reads a page at a time and keeps its place on the
// task, so a large workspace is read over several runs, each going on from
// where the last stopped, and a run that fails is retried from there.

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

const PEOPLE = { key: "members", item: slackMember };
const CHANNELS = {
  key: "channels",
  item: slackChannelItem,
  query: { types: "public_channel,private_channel", exclude_archived: "true" },
};

/**
 * How long a run starts pages for before it leaves the rest to the next one:
 * short enough that a run a request started ends inside the request's
 * waitUntil (30 seconds), its last page included.
 */
const RUN_MS = 10_000;
/** When the next run goes on: the minute cron's next tick. */
const RESUME_MS = 30_000;

/** Where a read stopped: its step, and that step's next page. */
const progressSchema = z.object({
  /** The connection it reads: a reconnect starts the read again. */
  connectedAt: z.string(),
  /** When the read started: whatever it didn't see was there before. */
  startedAt: z.string(),
  step: z.enum(["people", "channels", "installer-channels"]),
  cursor: z.string(),
});

type Progress = z.infer<typeof progressSchema>;

type Members = Awaited<ReturnType<typeof AuthRepository.listMembers>>;

type SyncRun =
  | { done: true; outcome: string }
  | { done: false; resumeAt: string };

/**
 * One run of a read: from where the last run stopped (`saved`, the task's
 * payload) for up to RUN_MS, keeping its place with `keep` after each page.
 * Done when the read finished, or Slack refused it; otherwise the next run
 * goes on at `resumeAt`. A failure, Slack's or the network's, is thrown, and
 * the task is retried from the last page kept.
 */
async function runSync(
  organizationId: string,
  saved: unknown,
  keep: (progress: Progress) => Promise<unknown>,
): Promise<SyncRun> {
  const connection = await SlackRepository.getConnection(organizationId);
  if (!connection) return { done: true, outcome: "Slack is not connected." };
  const now = new Date().toISOString();
  const parsed = progressSchema.safeParse(saved);
  let progress: Progress =
    parsed.success && parsed.data.connectedAt === connection.connectedAt
      ? parsed.data
      : {
          connectedAt: connection.connectedAt,
          startedAt: now,
          step: "people",
          cursor: "",
        };
  // Each run says the read is going on (SlackInventoryService.syncState).
  await SlackRepository.markSync(organizationId, { syncStartedAt: now });
  const members = await AuthRepository.listMembers(organizationId);
  const until = Date.now() + RUN_MS;
  try {
    do {
      const next = await readPage(
        organizationId,
        connection,
        members,
        progress,
      );
      if (!next) return await finish(organizationId, connection, progress);
      progress = next;
      await keep(progress);
    } while (Date.now() < until);
  } catch (error) {
    if (!(error instanceof SlackError)) throw error;
    // Slack wants a pause: the next run goes on from here.
    if (error.code === "ratelimited") return resumeLater();
    // Slack's own trouble: retried from the last page kept.
    if (slackTrouble(error.code)) throw error;
    // As in the CRM, the installer's own channels are only ever extra.
    if (progress.step === "installer-channels") {
      return finish(organizationId, connection, progress);
    }
    const moved = await connectionMoved(organizationId, connection);
    if (moved) return moved;
    await SlackRepository.markSync(organizationId, {
      syncedAt: new Date().toISOString(),
      syncError: error.message,
    });
    return { done: true, outcome: error.message };
  }
  return resumeLater();
}

/**
 * Where a run goes when the connection it read with is gone: disconnected,
 * the read is over; reconnected, what it saw may be another workspace's, so
 * the next run reads the new one from the start. Null when it is still there.
 */
async function connectionMoved(
  organizationId: string,
  connection: SlackConnectionRow,
): Promise<SyncRun | null> {
  const current = await SlackRepository.getConnection(organizationId);
  if (!current) return { done: true, outcome: "Slack is not connected." };
  return current.connectedAt === connection.connectedAt ? null : resumeLater();
}

/** Slack failed rather than refused: worth trying again. */
function slackTrouble(code: string): boolean {
  return (
    code.startsWith("http_5") ||
    [
      "internal_error",
      "fatal_error",
      "service_unavailable",
      "request_timeout",
      "unreadable_reply",
    ].includes(code)
  );
}

function resumeLater(): SyncRun {
  return {
    done: false,
    resumeAt: new Date(Date.now() + RESUME_MS).toISOString(),
  };
}

/** Reads and writes the page `progress` points at; where to go on, or null at the end. */
async function readPage(
  organizationId: string,
  connection: SlackConnectionRow,
  members: Members,
  progress: Progress,
): Promise<Progress | null> {
  const { step, cursor } = progress;
  if (step === "people") {
    const page = await slackPage(
      connection.botToken,
      "users.list",
      PEOPLE,
      cursor,
    );
    await SlackRepository.saveMatches(
      organizationId,
      matchesOn(page.items, members),
    );
    if (page.next) return { ...progress, cursor: page.next };
    await saveUnmatched(organizationId, progress.startedAt);
    return { ...progress, step: "channels", cursor: "" };
  }
  const installer = step === "installer-channels";
  const token = installer ? connection.userToken : connection.botToken;
  if (!token) return null;
  const canInviteItself = Boolean(connection.userToken);
  const page = await slackPage(token, "conversations.list", CHANNELS, cursor);
  await SlackRepository.saveChannels(
    organizationId,
    page.items
      .filter(
        (channel) =>
          !channel.is_archived &&
          (installer ||
            channel.is_member ||
            !channel.is_private ||
            canInviteItself),
      )
      .map((channel) => ({
        slackChannelId: channel.id,
        name: channel.name,
        memberCount: channel.num_members ?? null,
        isPrivate: channel.is_private ?? false,
        // The installer sees what the app is not in.
        isMember: !installer && (channel.is_member ?? false),
      })),
    installer ? progress.startedAt : null,
  );
  if (page.next) return { ...progress, cursor: page.next };
  if (installer || !connection.userToken) return null;
  return { ...progress, step: "installer-channels", cursor: "" };
}

/** The members a page of Slack's people matches by exact email. */
function matchesOn(people: z.infer<typeof slackMember>[], members: Members) {
  const byEmail = new Map(
    people
      .filter((person) => !person.deleted && !person.is_bot)
      .flatMap((person) => {
        const email = person.profile?.email?.trim().toLowerCase();
        return email ? [[email, person] as const] : [];
      }),
  );
  return members.flatMap((row) => {
    const slack = byEmail.get(row.email.trim().toLowerCase());
    return slack
      ? [
          {
            userId: row.userId,
            slackUserId: slack.id,
            slackHandle: `@${slack.name ?? slack.id}`,
            slackEmail: slack.profile?.email ?? null,
          },
        ]
      : [];
  });
}

/** Members no page of this read matched: matched to nobody. */
async function saveUnmatched(
  organizationId: string,
  startedAt: string,
): Promise<void> {
  const rows = await SlackRepository.listMatches(organizationId);
  await SlackRepository.saveMatches(
    organizationId,
    rows
      .filter((row) => !row.reviewedAt || row.reviewedAt < startedAt)
      .map((row) => ({
        userId: row.userId,
        slackUserId: null,
        slackHandle: null,
        slackEmail: null,
      })),
  );
}

async function finish(
  organizationId: string,
  connection: SlackConnectionRow,
  progress: Progress,
): Promise<SyncRun> {
  const moved = await connectionMoved(organizationId, connection);
  if (moved) return moved;
  await SlackRepository.markUnseenUnavailable(
    organizationId,
    progress.startedAt,
  );
  // Display-only: a failed lookup keeps the name read last time.
  const name = await appName(connection.botToken).catch(() => null);
  await SlackRepository.markSync(organizationId, {
    syncedAt: new Date().toISOString(),
    syncError: null,
    ...(name ? { botName: name } : {}),
  });
  return { done: true, outcome: "Read Slack's people and channels." };
}

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

export const SlackSyncService = { runSync };
