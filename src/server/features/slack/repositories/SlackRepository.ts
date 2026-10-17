import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  member,
  slackChannel,
  slackConnection,
  slackMemberMatch,
  slackOauthState,
  user,
} from "@/db/schema";

// The organization's Slack connection, its channel inventory and the
// member ↔ Slack user matches. The connection row holds the tokens: only the
// Slack service reads them, to call Slack on the server.

const CHANNEL_CHUNK = 10;

export type SlackConnectionRow = NonNullable<
  Awaited<ReturnType<typeof getConnection>>
>;

async function getConnection(organizationId: string) {
  const [row] = await db
    .select()
    .from(slackConnection)
    .where(eq(slackConnection.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/** Saves the workspace a connect returned, replacing any earlier one. */
async function saveConnection(input: {
  organizationId: string;
  teamId: string;
  teamName: string | null;
  botUserId: string | null;
  botToken: string;
  botScopes: string;
  userToken: string | null;
  userScopes: string | null;
  connectedById: string;
}): Promise<{ replacedTeam: boolean }> {
  const previous = await getConnection(input.organizationId);
  const now = new Date().toISOString();
  const values = {
    ...input,
    connectedAt: now,
    syncStartedAt: null,
    syncedAt: null,
    syncError: null,
  };
  const replacedTeam = previous !== null && previous.teamId !== input.teamId;
  await runBatch((tx) => [
    // Another workspace's channels mean nothing to this one.
    ...(replacedTeam
      ? [
          tx
            .delete(slackChannel)
            .where(eq(slackChannel.organizationId, input.organizationId)),
        ]
      : []),
    tx
      .insert(slackConnection)
      .values({ id: crypto.randomUUID(), ...values })
      .onConflictDoUpdate({
        target: slackConnection.organizationId,
        set: values,
      }),
  ]);
  return { replacedTeam };
}

/**
 * Forgets the connection and its channel list; who is matched to which Slack
 * user is kept, so reconnecting the same workspace needs no matching again.
 */
async function deleteConnection(organizationId: string): Promise<boolean> {
  const existing = await getConnection(organizationId);
  if (!existing) return false;
  await runBatch((tx) => [
    tx
      .delete(slackChannel)
      .where(eq(slackChannel.organizationId, organizationId)),
    tx
      .delete(slackConnection)
      .where(eq(slackConnection.organizationId, organizationId)),
  ]);
  return true;
}

async function markSync(
  organizationId: string,
  patch: {
    syncStartedAt?: string;
    syncedAt?: string;
    syncError?: string | null;
  },
): Promise<void> {
  await db
    .update(slackConnection)
    .set(patch)
    .where(eq(slackConnection.organizationId, organizationId));
}

// Channels.

const channelColumns = () => ({
  id: slackChannel.id,
  slackChannelId: slackChannel.slackChannelId,
  name: slackChannel.name,
  memberCount: slackChannel.memberCount,
  isPrivate: slackChannel.isPrivate,
  isMember: slackChannel.isMember,
  classifiedAt: slackChannel.classifiedAt,
  inviteRequestedAt: slackChannel.inviteRequestedAt,
});

export type SlackChannelRow = Awaited<ReturnType<typeof listChannels>>[number];

/** Available channels, the ones the app is in first, then by name. */
async function listChannels(
  organizationId: string,
  input: { query?: string; limit: number; offset: number },
) {
  const needle = input.query?.trim().toLowerCase();
  return db
    .select(channelColumns())
    .from(slackChannel)
    .where(
      and(
        eq(slackChannel.organizationId, organizationId),
        eq(slackChannel.available, true),
        needle
          ? sql`lower(${slackChannel.name}) like ${`%${needle}%`}`
          : undefined,
      ),
    )
    .orderBy(
      desc(slackChannel.isMember),
      asc(slackChannel.name),
      asc(slackChannel.id),
    )
    .limit(input.limit)
    .offset(input.offset);
}

async function findChannel(organizationId: string, slackChannelId: string) {
  const [row] = await db
    .select(channelColumns())
    .from(slackChannel)
    .where(
      and(
        eq(slackChannel.organizationId, organizationId),
        eq(slackChannel.slackChannelId, slackChannelId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findChannelByName(organizationId: string, name: string) {
  const [row] = await db
    .select(channelColumns())
    .from(slackChannel)
    .where(
      and(
        eq(slackChannel.organizationId, organizationId),
        eq(slackChannel.name, name),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type ChannelWrite = {
  slackChannelId: string;
  name: string;
  memberCount: number | null;
  isPrivate: boolean;
  isMember: boolean;
};

/**
 * Replaces the inventory with `channels`: each written or refreshed, every
 * channel not among them marked unavailable.
 */
async function replaceChannels(
  organizationId: string,
  channels: ChannelWrite[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const rows of chunk(channels, CHANNEL_CHUNK)) {
    await runBatch((tx) =>
      rows.map((channel) =>
        tx
          .insert(slackChannel)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            ...channel,
            available: true,
            classifiedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [slackChannel.organizationId, slackChannel.slackChannelId],
            set: {
              ...channel,
              available: true,
              classifiedAt: now,
              updatedAt: now,
            },
          }),
      ),
    );
  }
  // Everything this read didn't see was refreshed before it started.
  await db
    .update(slackChannel)
    .set({ available: false, updatedAt: now })
    .where(
      and(
        eq(slackChannel.organizationId, organizationId),
        lt(slackChannel.updatedAt, now),
      ),
    );
}

async function upsertChannel(
  organizationId: string,
  channel: ChannelWrite,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(slackChannel)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      ...channel,
      available: true,
      classifiedAt: now,
    })
    .onConflictDoUpdate({
      target: [slackChannel.organizationId, slackChannel.slackChannelId],
      set: { ...channel, available: true, classifiedAt: now, updatedAt: now },
    });
}

async function updateChannel(
  organizationId: string,
  slackChannelId: string,
  patch: Partial<{
    isMember: boolean;
    isPrivate: boolean;
    inviteRequestedAt: string | null;
    classifiedAt: string;
  }>,
): Promise<void> {
  await db
    .update(slackChannel)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(slackChannel.organizationId, organizationId),
        eq(slackChannel.slackChannelId, slackChannelId),
      ),
    );
}

// People.

/** Every mirrored member with their Slack match, by name. */
async function listMatches(organizationId: string) {
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      slackUserId: slackMemberMatch.slackUserId,
      slackHandle: slackMemberMatch.slackHandle,
      slackEmail: slackMemberMatch.slackEmail,
      reviewedAt: slackMemberMatch.updatedAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      slackMemberMatch,
      and(
        eq(slackMemberMatch.organizationId, organizationId),
        eq(slackMemberMatch.userId, member.userId),
      ),
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(user.name));
}

async function saveMatches(
  organizationId: string,
  matches: Array<{
    userId: string;
    slackUserId: string | null;
    slackHandle: string | null;
    slackEmail: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  for (const rows of chunk(matches, CHANNEL_CHUNK)) {
    await runBatch((tx) =>
      rows.map((match) =>
        tx
          .insert(slackMemberMatch)
          .values({ id: crypto.randomUUID(), organizationId, ...match })
          .onConflictDoUpdate({
            target: [slackMemberMatch.organizationId, slackMemberMatch.userId],
            set: { ...match, updatedAt: now },
          }),
      ),
    );
  }
}

// OAuth state.

async function insertState(
  organizationId: string,
  userId: string,
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.insert(slackOauthState).values({ id, organizationId, userId });
  return id;
}

/**
 * Accepts `state` once: for this organization and person, minted after
 * `notBefore`. Spent either way.
 */
async function consumeState(
  organizationId: string,
  userId: string,
  state: string,
  notBefore: string,
): Promise<boolean> {
  const rows = await db
    .delete(slackOauthState)
    .where(
      and(
        eq(slackOauthState.id, state),
        eq(slackOauthState.organizationId, organizationId),
        eq(slackOauthState.userId, userId),
        gte(slackOauthState.createdAt, notBefore),
      ),
    )
    .returning({ id: slackOauthState.id });
  // Old, unused states go with any connect.
  await db
    .delete(slackOauthState)
    .where(
      and(
        eq(slackOauthState.organizationId, organizationId),
        lt(slackOauthState.createdAt, notBefore),
      ),
    );
  return rows.length > 0;
}

export const SlackRepository = {
  getConnection,
  saveConnection,
  deleteConnection,
  markSync,
  listChannels,
  findChannel,
  findChannelByName,
  replaceChannels,
  upsertChannel,
  updateChannel,
  listMatches,
  saveMatches,
  insertState,
  consumeState,
};
