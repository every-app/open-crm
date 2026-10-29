import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { agentConversation } from "./agent.schema";
import { organization } from "./auth.schema";
import { isoNow, timestamp } from "./columns";

// Retired with team agents (team-agent.schema.ts).

/**
 * A builder chat's read-only link: at most one
 * per chat, kept only as the SHA-256 of its token. Replacing the link
 * overwrites the hash and revoking it deletes the row, so an old link stops
 * opening the chat at once.
 */
export const agentConversationShare = sqliteTable("agent_conversation_share", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => agentConversation.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at").notNull().default(isoNow),
});
