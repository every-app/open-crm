// Postgres mirror of ../agent.schema.ts; schema-parity.test.ts keeps the two
// structurally identical.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { AGENT_CONVERSATION_KINDS } from "../../shared/crm-enums";
import { organization, user } from "./auth.schema";
import { isoNow, timestamp } from "./columns";
import { company, contact, deal } from "./crm.schema";

const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/**
 * The research agent's work queue. The minute cron leases what is due
 * (src/server/features/agent/dispatch.ts): a lease is a conditional update
 * on `leased_until`, so two dispatchers never take the same row on either
 * backend. Anything that looks like "every N minutes" belongs in `due_at`,
 * not in a cron expression.
 */
export const agentTask = pgTable(
  "agent_task",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    dealId: text("deal_id"),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<unknown>(),
    priority: integer("priority").notNull().default(0),
    budget: integer("budget").notNull().default(4),
    attempts: integer("attempts").notNull().default(0),
    dueAt: timestamp("due_at").notNull(),
    leasedUntil: timestamp("leased_until"),
    sessionId: text("session_id"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    outcome: text("outcome"),
    // What the task is about ("contact:<id>", "company:<id>", ...): at most
    // one open task of a kind per subject, enforced by the partial unique
    // index below rather than a lock.
    subject: text("subject"),
    createdAt: timestamp("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("agent_task_due_lease_idx").on(table.dueAt, table.leasedUntil),
    index("agent_task_organization_contact_idx").on(
      table.organizationId,
      table.contactId,
    ),
    index("agent_task_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    index("agent_task_organization_deal_idx").on(
      table.organizationId,
      table.dealId,
    ),
    // The open tasks, for the dispatcher's claims and the stale-task scan:
    // finished ones are nearly all of the table.
    index("agent_task_open_due_idx")
      .on(table.dueAt)
      .where(sql`${table.finishedAt} is null`),
    uniqueIndex("agent_task_open_kind_subject_uidx")
      .on(table.organizationId, table.kind, table.subject)
      .where(sql`${table.finishedAt} is null`),
  ],
);

/**
 * When each lane of the minute cron last ran, for the dispatcher's health
 * check (src/server/features/health). One row per lane for the whole
 * deployment: it holds no organization's data.
 */
export const dispatcherLane = pgTable("dispatcher_lane", {
  lane: text("lane").primaryKey(),
  ranAt: timestamp("ran_at").notNull(),
  failedAt: timestamp("failed_at"),
});

/**
 * The paid agent sessions each organization has running, where usage is
 * billed: a few chat turns, research sessions and team agent runs at once
 * (src/server/billing/paidSessions.ts). A session holds a numbered slot until
 * it ends, or until its lease runs out; the slot number in the key keeps the
 * count exact on both backends.
 */
export const paidSession = pgTable(
  "paid_session",
  {
    organizationId: organizationId(),
    kind: text("kind").notNull(),
    slot: integer("slot").notNull(),
    sessionId: text("session_id").notNull(),
    leasedUntil: timestamp("leased_until").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.kind, table.slot] }),
  ],
);

/** What the agent did, step by step, for the Agent tab and the audit. */
export const agentEvent = pgTable(
  "agent_event",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    sessionId: text("session_id").notNull(),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    dealId: text("deal_id"),
    conversationId: text("conversation_id").references(
      () => agentConversation.id,
      { onDelete: "cascade" },
    ),
    type: text("type").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    emittedAt: timestamp("emitted_at").notNull(),
  },
  (table) => [
    index("agent_event_session_emitted_idx").on(
      table.sessionId,
      table.emittedAt,
    ),
    index("agent_event_organization_contact_emitted_idx").on(
      table.organizationId,
      table.contactId,
      table.emittedAt,
    ),
    index("agent_event_organization_company_emitted_idx").on(
      table.organizationId,
      table.companyId,
      table.emittedAt,
    ),
    index("agent_event_organization_deal_emitted_idx").on(
      table.organizationId,
      table.dealId,
      table.emittedAt,
    ),
    index("agent_event_conversation_emitted_idx").on(
      table.conversationId,
      table.emittedAt,
    ),
  ],
);

/**
 * A person's conversation with the agent about one record. The messages live
 * in the agent's Durable Object (named by `session_id`); this row is what
 * lists and badges need.
 */
export const agentConversation = pgTable(
  "agent_conversation",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    kind: text("kind", { enum: AGENT_CONVERSATION_KINDS })
      .notNull()
      .default("RECORD"),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "cascade",
    }),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "cascade",
    }),
    dealId: text("deal_id").references(() => deal.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull().unique(),
    title: text("title"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().default(isoNow),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
    lastMessageAt: timestamp("last_message_at").notNull().default(isoNow),
    lastAssistantAt: timestamp("last_assistant_at"),
    lastReadAt: timestamp("last_read_at"),
  },
  (table) => [
    index("agent_conversation_contact_last_idx").on(
      table.contactId,
      table.lastMessageAt,
    ),
    index("agent_conversation_company_last_idx").on(
      table.companyId,
      table.lastMessageAt,
    ),
    index("agent_conversation_deal_last_idx").on(
      table.dealId,
      table.lastMessageAt,
    ),
    index("agent_conversation_organization_user_kind_last_idx").on(
      table.organizationId,
      table.userId,
      table.kind,
      table.lastMessageAt,
    ),
  ],
);
