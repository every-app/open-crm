import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  ACTION_STATUSES,
  AGENT_VERSION_STATUSES,
  ARTIFACT_STATUSES,
  CRM_EVENT_TYPES,
  FEEDBACK_RATINGS,
  RUN_STATUSES,
  TEAM_AGENT_STATUSES,
  TRIGGER_TYPES,
} from "../shared/team-agents";
import { agentConversation } from "./agent.schema";
import { organization, user } from "./auth.schema";
import { isoNow, timestamp } from "./columns";

// Team agents (src/shared/team-agents.ts): an agent a team built in a private
// builder chat, its immutable versions and their files, the triggers that run
// it, its runs and the ledger of what each run did, and the audit of every
// change. Every table hangs off `organization_id`.

const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at").notNull().default(isoNow);

/** A team agent. A DRAFT is its creator's; deploying makes it the team's. */
export const agentDefinition = sqliteTable(
  "agent_definition",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: TEAM_AGENT_STATUSES })
      .notNull()
      .default("DRAFT"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // The builder chat it was made in (one agent per chat).
    conversationId: text("conversation_id").references(
      () => agentConversation.id,
      { onDelete: "set null" },
    ),
    // The deployed version the team runs; null until the first deploy.
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
    archivedAt: timestamp("archived_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("agent_definition_organization_status_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("agent_definition_conversation_uidx").on(table.conversationId),
  ],
);

/** One immutable version: its instructions and manifest, as reviewed. */
export const agentVersion = sqliteTable(
  "agent_version",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentDefinition.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: text("status", { enum: AGENT_VERSION_STATUSES })
      .notNull()
      .default("READY"),
    instructions: text("instructions").notNull(),
    manifest: text("manifest", { mode: "json" }).$type<unknown>().notNull(),
    modelId: text("model_id").notNull(),
    sourceConversationId: text("source_conversation_id").references(
      () => agentConversation.id,
      { onDelete: "set null" },
    ),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at"),
    deployedAt: timestamp("deployed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_version_agent_number_uidx").on(
      table.agentId,
      table.number,
    ),
  ],
);

/**
 * A file the builder wrote, revision by revision: working revisions in the
 * chat (WRITING), and the exact snapshot a version was saved with (READY).
 */
export const agentBuilderArtifact = sqliteTable(
  "agent_builder_artifact",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    conversationId: text("conversation_id").references(
      () => agentConversation.id,
      { onDelete: "set null" },
    ),
    versionId: text("version_id").references(() => agentVersion.id, {
      onDelete: "cascade",
    }),
    path: text("path").notNull(),
    language: text("language").notNull(),
    content: text("content").notNull(),
    previousContent: text("previous_content"),
    revision: integer("revision").notNull(),
    status: text("status", { enum: ARTIFACT_STATUSES })
      .notNull()
      .default("WRITING"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_builder_artifact_conversation_path_revision_uidx")
      .on(table.conversationId, table.path, table.revision)
      .where(sql`${table.conversationId} is not null`),
    uniqueIndex("agent_builder_artifact_version_path_revision_uidx")
      .on(table.versionId, table.path, table.revision)
      .where(sql`${table.versionId} is not null`),
  ],
);

/**
 * When a version runs. A SCHEDULE trigger is due at `next_run_at` and recurs
 * every `interval_minutes`; an EVENT trigger names its CRM event. Deploying a
 * version enables its triggers and disables every other version's.
 */
export const agentTrigger = sqliteTable(
  "agent_trigger",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentDefinition.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    type: text("type", { enum: TRIGGER_TYPES }).notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    event: text("event", { enum: CRM_EVENT_TYPES }),
    intervalMinutes: integer("interval_minutes"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // The minute cron's scan for due schedules, across organizations.
    index("agent_trigger_enabled_next_run_idx").on(
      table.enabled,
      table.nextRunAt,
    ),
    index("agent_trigger_organization_event_idx").on(
      table.organizationId,
      table.event,
      table.enabled,
    ),
    index("agent_trigger_agent_idx").on(table.agentId),
  ],
);

/**
 * One run of a version. The row is the authority on whether it may still
 * act: every runner tool refuses a run that is not RUNNING. At most one run
 * of an agent is RUNNING at a time (the partial unique index).
 */
export const agentRun = sqliteTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentDefinition.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    triggerId: text("trigger_id").references(() => agentTrigger.id, {
      onDelete: "set null",
    }),
    initiatedById: text("initiated_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    triggerType: text("trigger_type", { enum: TRIGGER_TYPES }).notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("QUEUED"),
    sessionId: text("session_id"),
    // What made it: the person's request id, the schedule slot, the event.
    idempotencyKey: text("idempotency_key").notNull(),
    input: text("input", { mode: "json" }).$type<unknown>(),
    result: text("result", { mode: "json" }).$type<unknown>(),
    summary: text("summary"),
    noActionNeeded: text("no_action_needed"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("agent_run_organization_idempotency_uidx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_run_one_running_uidx")
      .on(table.agentId)
      .where(sql`${table.status} = 'RUNNING'`),
    index("agent_run_organization_agent_created_idx").on(
      table.organizationId,
      table.agentId,
      table.createdAt,
    ),
    // The dispatcher's scan for queued and overrunning runs.
    index("agent_run_status_created_idx").on(table.status, table.createdAt),
  ],
);

/**
 * The action ledger: every side effect a run attempts is a row before it
 * happens, keyed by the run and the model's tool call, so a replayed call
 * finds the action it already took instead of taking it twice.
 */
export const agentAction = sqliteTable(
  "agent_action",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentDefinition.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    summary: text("summary").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<unknown>(),
    status: text("status", { enum: ACTION_STATUSES })
      .notNull()
      .default("PLANNED"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash"),
    externalId: text("external_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    plannedAt: timestamp("planned_at").notNull().default(isoNow),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("agent_action_organization_idempotency_uidx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("agent_action_run_planned_idx").on(table.runId, table.plannedAt),
  ],
);

/** Every change to an agent and every run request, for its Activity tab. */
export const agentAuditEvent = sqliteTable(
  "agent_audit_event",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentDefinition.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => agentVersion.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // USER, AGENT (a run) or SYSTEM (the dispatcher).
    actorType: text("actor_type").notNull(),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    before: text("before", { mode: "json" }).$type<unknown>(),
    after: text("after", { mode: "json" }).$type<unknown>(),
    // A request replayed with the same id is recorded once.
    requestId: text("request_id"),
    emittedAt: timestamp("emitted_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("agent_audit_event_agent_type_request_uidx").on(
      table.agentId,
      table.type,
      table.requestId,
    ),
    index("agent_audit_event_agent_emitted_idx").on(
      table.agentId,
      table.emittedAt,
    ),
  ],
);

/** A thumbs up or down on one of the builder's replies. */
export const agentConversationFeedback = sqliteTable(
  "agent_conversation_feedback",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    rating: text("rating", { enum: FEEDBACK_RATINGS }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("agent_conversation_feedback_message_uidx").on(
      table.conversationId,
      table.userId,
      table.messageId,
    ),
  ],
);

/** A file a person attached in a builder chat; the bytes live in R2. */
export const agentConversationAttachment = sqliteTable(
  "agent_conversation_attachment",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("agent_conversation_attachment_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
