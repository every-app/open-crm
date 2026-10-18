// Postgres mirror of ../sharing.schema.ts; schema-parity.test.ts keeps the two
// structurally identical.
import { pgTable, text } from "drizzle-orm/pg-core";
import { agentConversation } from "./agent.schema";
import { organization } from "./auth.schema";
import { isoNow, timestamp } from "./columns";

/**
 * A builder chat's read-only link (src/server/features/sharing): at most one
 * per chat, kept only as the SHA-256 of its token. Replacing the link
 * overwrites the hash and revoking it deletes the row, so an old link stops
 * opening the chat at once.
 */
export const agentConversationShare = pgTable("agent_conversation_share", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => agentConversation.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at").notNull().default(isoNow),
});
