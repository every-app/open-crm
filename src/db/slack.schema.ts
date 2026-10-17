import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization, user } from "./auth.schema";
import { isoNow, timestamp } from "./columns";

// The organization's Slack workspace, connected by an owner or admin through
// the Every App gateway's `slack` OAuth client (src/server/features/slack):
// the tokens Slack issued, the channels the CRM can reach, and which members
// are which Slack users. Tokens are read on the server only, to call Slack;
// they never reach a client, a log, the model or an MCP tool.

const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/** One Slack workspace per organization. */
export const slackConnection = sqliteTable(
  "slack_connection",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    teamId: text("team_id").notNull(),
    teamName: text("team_name"),
    botUserId: text("bot_user_id"),
    botToken: text("bot_token").notNull(),
    // Comma-separated, as Slack reports them.
    botScopes: text("bot_scopes").notNull(),
    // The installer's user token: lets the app create private channels and
    // invite itself into them. Absent when the installer declined it.
    userToken: text("user_token"),
    userScopes: text("user_scopes"),
    connectedById: text("connected_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at").notNull().default(isoNow),
    // The last read of Slack's people and channels: started, and finished.
    syncStartedAt: timestamp("sync_started_at"),
    syncedAt: timestamp("synced_at"),
    syncError: text("sync_error"),
  },
  (table) => [
    uniqueIndex("slack_connection_organization_uidx").on(table.organizationId),
  ],
);

/** A Slack channel the CRM can see, as of the last read. */
export const slackChannel = sqliteTable(
  "slack_channel",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    slackChannelId: text("slack_channel_id").notNull(),
    name: text("name").notNull(),
    memberCount: integer("member_count"),
    available: integer("available", { mode: "boolean" })
      .notNull()
      .default(true),
    isPrivate: integer("is_private", { mode: "boolean" })
      .notNull()
      .default(false),
    isMember: integer("is_member", { mode: "boolean" })
      .notNull()
      .default(false),
    inviteRequestedAt: timestamp("invite_requested_at"),
    classifiedAt: timestamp("classified_at"),
    createdAt: timestamp("created_at").notNull().default(isoNow),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("slack_channel_organization_channel_uidx").on(
      table.organizationId,
      table.slackChannelId,
    ),
    index("slack_channel_organization_name_idx").on(
      table.organizationId,
      table.available,
      table.name,
    ),
  ],
);

/** A member matched to a Slack user by exact email, or reviewed unmatched. */
export const slackMemberMatch = sqliteTable(
  "slack_member_match",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slackUserId: text("slack_user_id"),
    slackHandle: text("slack_handle"),
    slackEmail: text("slack_email"),
    createdAt: timestamp("created_at").notNull().default(isoNow),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("slack_member_match_organization_user_uidx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

/**
 * An OAuth `state` handed to Slack when an owner or admin starts connecting:
 * the callback accepts it once, for the same person, within minutes.
 */
export const slackOauthState = sqliteTable("slack_oauth_state", {
  id: text("id").primaryKey(),
  organizationId: organizationId(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(isoNow),
});
