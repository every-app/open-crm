import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  agentAuditEvent,
  agentBuilderArtifact,
  agentDefinition,
  agentRun,
  agentTrigger,
  agentVersion,
  user,
} from "@/db/schema";
import {
  TEAM_VISIBLE_STATUSES,
  type CrmEventType,
  type TeamAgentStatus,
  type TriggerType,
} from "@/shared/team-agents";

// Team agents, their versions, triggers, files and audit (team-agent.schema).
// Every read and write is scoped to the organization; an agent id from a
// client is never trusted on its own.

const ID_CHUNK = 90;

const agentColumns = () => ({
  id: agentDefinition.id,
  name: agentDefinition.name,
  description: agentDefinition.description,
  status: agentDefinition.status,
  createdById: agentDefinition.createdById,
  createdByName: user.name,
  conversationId: agentDefinition.conversationId,
  currentVersionId: agentDefinition.currentVersionId,
  createdAt: agentDefinition.createdAt,
  updatedAt: agentDefinition.updatedAt,
  archivedAt: agentDefinition.archivedAt,
});

/**
 * The agents a person sees: the team's (live, paused, archived) and their own
 * drafts, most recently changed first.
 */
async function listVisible(organizationId: string, userId: string) {
  return db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        or(
          inArray(agentDefinition.status, [...TEAM_VISIBLE_STATUSES]),
          and(
            eq(agentDefinition.status, "DRAFT"),
            eq(agentDefinition.createdById, userId),
          ),
        ),
      ),
    )
    .orderBy(desc(agentDefinition.updatedAt), desc(agentDefinition.id))
    .limit(200);
}

/** One agent of the organization, unless it was deleted. */
async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        ne(agentDefinition.status, "DELETED"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The agent a builder chat made, if it has saved one. */
async function findByConversation(
  organizationId: string,
  conversationId: string,
) {
  const [row] = await db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.conversationId, conversationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Run counts per agent. */
async function runCounts(
  organizationId: string,
  agentIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const ids of chunk(agentIds, ID_CHUNK)) {
    const rows = await db
      .select({ agentId: agentRun.agentId, runs: count() })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.organizationId, organizationId),
          inArray(agentRun.agentId, ids),
        ),
      )
      .groupBy(agentRun.agentId);
    for (const row of rows) counts.set(row.agentId, row.runs);
  }
  return counts;
}

/** The enabled triggers of these agents. */
async function enabledTriggers(organizationId: string, agentIds: string[]) {
  const rows = [];
  for (const ids of chunk(agentIds, ID_CHUNK)) {
    rows.push(
      ...(await db
        .select(triggerColumns())
        .from(agentTrigger)
        .where(
          and(
            eq(agentTrigger.organizationId, organizationId),
            inArray(agentTrigger.agentId, ids),
            eq(agentTrigger.enabled, true),
          ),
        )
        .orderBy(asc(agentTrigger.nextRunAt), asc(agentTrigger.id))),
    );
  }
  return rows;
}

async function insertAgent(values: {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdById: string;
  conversationId: string | null;
}): Promise<void> {
  await db.insert(agentDefinition).values(values);
}

/**
 * Moves the agent from one of `from` to `status`, with `patch`. The row as it
 * now is, or null when it wasn't in one of those statuses.
 */
async function transition(
  organizationId: string,
  id: string,
  from: readonly TeamAgentStatus[],
  status: TeamAgentStatus,
  patch: Partial<{
    archivedAt: string | null;
    deletedAt: string | null;
  }> = {},
) {
  const [row] = await db
    .update(agentDefinition)
    .set({ status, ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        inArray(agentDefinition.status, [...from]),
      ),
    )
    .returning({
      id: agentDefinition.id,
      name: agentDefinition.name,
      status: agentDefinition.status,
    });
  return row ?? null;
}

async function updateDetails(
  organizationId: string,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<boolean> {
  const rows = await db
    .update(agentDefinition)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        ne(agentDefinition.status, "DELETED"),
      ),
    )
    .returning({ id: agentDefinition.id });
  return rows.length > 0;
}

// Versions.

const versionColumns = () => ({
  id: agentVersion.id,
  agentId: agentVersion.agentId,
  number: agentVersion.number,
  status: agentVersion.status,
  instructions: agentVersion.instructions,
  manifest: agentVersion.manifest,
  modelId: agentVersion.modelId,
  sourceConversationId: agentVersion.sourceConversationId,
  createdById: agentVersion.createdById,
  approvedAt: agentVersion.approvedAt,
  deployedAt: agentVersion.deployedAt,
  createdAt: agentVersion.createdAt,
});

export type VersionRow = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

async function findVersion(
  organizationId: string,
  agentId: string,
  versionId: string,
) {
  const [row] = await db
    .select(versionColumns())
    .from(agentVersion)
    .where(
      and(
        eq(agentVersion.organizationId, organizationId),
        eq(agentVersion.agentId, agentId),
        eq(agentVersion.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The agent's newest version. */
async function latestVersion(organizationId: string, agentId: string) {
  const [row] = await db
    .select(versionColumns())
    .from(agentVersion)
    .where(
      and(
        eq(agentVersion.organizationId, organizationId),
        eq(agentVersion.agentId, agentId),
      ),
    )
    .orderBy(desc(agentVersion.number))
    .limit(1);
  return row ?? null;
}

export type NewVersion = {
  id: string;
  organizationId: string;
  agentId: string;
  number: number;
  status: "READY" | "DEPLOYED";
  instructions: string;
  manifest: unknown;
  modelId: string;
  sourceConversationId: string | null;
  createdById: string;
  approvedAt?: string | null;
  deployedAt?: string | null;
};

export type NewTrigger = {
  id: string;
  organizationId: string;
  agentId: string;
  versionId: string;
  type: TriggerType;
  name: string;
  summary: string;
  event: CrmEventType | null;
  intervalMinutes: number | null;
  nextRunAt: string | null;
  enabled: boolean;
};

export type NewArtifact = {
  id: string;
  organizationId: string;
  conversationId: string | null;
  versionId: string | null;
  path: string;
  language: string;
  content: string;
  previousContent: string | null;
  revision: number;
  status: "WRITING" | "READY";
};

export type NewAudit = {
  organizationId: string;
  agentId: string;
  versionId?: string | null;
  actorUserId?: string | null;
  actorType: "USER" | "AGENT" | "SYSTEM";
  type: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

function auditValues(event: NewAudit) {
  return {
    id: crypto.randomUUID(),
    organizationId: event.organizationId,
    agentId: event.agentId,
    versionId: event.versionId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorType: event.actorType,
    type: event.type,
    summary: event.summary,
    before: event.before ?? null,
    after: event.after ?? null,
    requestId: event.requestId ?? null,
    emittedAt: new Date().toISOString(),
  };
}

/**
 * Writes a new version with its triggers, file snapshots and audit lines in
 * one batch, so a version never exists without the triggers it declares.
 * `agent` creates the agent first (the chat's first save).
 */
async function saveVersion(input: {
  agent?: Parameters<typeof insertAgent>[0];
  renameDraft?: { name: string; description: string };
  version: NewVersion;
  triggers: NewTrigger[];
  artifacts: NewArtifact[];
  /** WRITING revisions this save snapshots in place (now READY). */
  claimedArtifactIds: string[];
  audit: NewAudit[];
}): Promise<void> {
  const { version } = input;
  await runBatch((tx) => [
    ...(input.agent ? [tx.insert(agentDefinition).values(input.agent)] : []),
    ...(input.renameDraft
      ? [
          tx
            .update(agentDefinition)
            .set({
              ...input.renameDraft,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(agentDefinition.organizationId, version.organizationId),
                eq(agentDefinition.id, version.agentId),
                eq(agentDefinition.status, "DRAFT"),
              ),
            ),
        ]
      : []),
    tx.insert(agentVersion).values(version),
    ...(input.triggers.length > 0
      ? [tx.insert(agentTrigger).values(input.triggers)]
      : []),
    ...(input.artifacts.length > 0
      ? [tx.insert(agentBuilderArtifact).values(input.artifacts)]
      : []),
    ...(input.claimedArtifactIds.length > 0
      ? [
          tx
            .update(agentBuilderArtifact)
            .set({ versionId: version.id, status: "READY" })
            .where(
              and(
                eq(agentBuilderArtifact.organizationId, version.organizationId),
                inArray(agentBuilderArtifact.id, input.claimedArtifactIds),
              ),
            ),
        ]
      : []),
    ...input.audit.map((event) =>
      tx.insert(agentAuditEvent).values(auditValues(event)),
    ),
  ]);
}

/**
 * Makes `versionId` the team's: it alone DEPLOYED, the agent LIVE on it, its
 * triggers the only enabled ones, and the audit line, in one batch. A replay
 * of the same request trips the audit line's unique key and changes nothing.
 */
async function deploy(input: {
  organizationId: string;
  agentId: string;
  versionId: string;
  name: string;
  description: string | null;
  audit: NewAudit;
}): Promise<void> {
  const { organizationId, agentId, versionId } = input;
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(agentVersion)
      .set({ status: "READY" })
      .where(
        and(
          eq(agentVersion.organizationId, organizationId),
          eq(agentVersion.agentId, agentId),
          eq(agentVersion.status, "DEPLOYED"),
          ne(agentVersion.id, versionId),
        ),
      ),
    tx
      .update(agentVersion)
      .set({ status: "DEPLOYED", approvedAt: now, deployedAt: now })
      .where(
        and(
          eq(agentVersion.organizationId, organizationId),
          eq(agentVersion.id, versionId),
        ),
      ),
    tx
      .update(agentDefinition)
      .set({
        currentVersionId: versionId,
        status: "LIVE",
        archivedAt: null,
        name: input.name,
        description: input.description,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentDefinition.organizationId, organizationId),
          eq(agentDefinition.id, agentId),
        ),
      ),
    tx
      .update(agentTrigger)
      .set({ enabled: sql`${agentTrigger.versionId} = ${versionId}` })
      .where(
        and(
          eq(agentTrigger.organizationId, organizationId),
          eq(agentTrigger.agentId, agentId),
        ),
      ),
    tx.insert(agentAuditEvent).values(auditValues(input.audit)),
  ]);
}

/**
 * Puts the agent on a new version derived from its current one (a revision
 * from the detail page), moving its triggers over, in one batch.
 */
async function replaceCurrentVersion(input: {
  version: NewVersion;
  fromVersionId: string;
  artifacts: NewArtifact[];
  audit: NewAudit;
}): Promise<void> {
  const { version } = input;
  await runBatch((tx) => [
    tx.insert(agentVersion).values(version),
    ...(input.artifacts.length > 0
      ? [tx.insert(agentBuilderArtifact).values(input.artifacts)]
      : []),
    tx
      .update(agentVersion)
      .set({ status: "READY" })
      .where(
        and(
          eq(agentVersion.organizationId, version.organizationId),
          eq(agentVersion.id, input.fromVersionId),
        ),
      ),
    tx
      .update(agentDefinition)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(agentDefinition.organizationId, version.organizationId),
          eq(agentDefinition.id, version.agentId),
        ),
      ),
    tx
      .update(agentTrigger)
      .set({ versionId: version.id })
      .where(
        and(
          eq(agentTrigger.organizationId, version.organizationId),
          eq(agentTrigger.agentId, version.agentId),
          eq(agentTrigger.versionId, input.fromVersionId),
        ),
      ),
    tx.insert(agentAuditEvent).values(auditValues(input.audit)),
  ]);
}

// Triggers.

const triggerColumns = () => ({
  id: agentTrigger.id,
  agentId: agentTrigger.agentId,
  versionId: agentTrigger.versionId,
  type: agentTrigger.type,
  name: agentTrigger.name,
  summary: agentTrigger.summary,
  event: agentTrigger.event,
  intervalMinutes: agentTrigger.intervalMinutes,
  enabled: agentTrigger.enabled,
  nextRunAt: agentTrigger.nextRunAt,
  lastRunAt: agentTrigger.lastRunAt,
});

async function triggersForVersion(organizationId: string, versionId: string) {
  return db
    .select(triggerColumns())
    .from(agentTrigger)
    .where(
      and(
        eq(agentTrigger.organizationId, organizationId),
        eq(agentTrigger.versionId, versionId),
      ),
    )
    .orderBy(asc(agentTrigger.createdAt), asc(agentTrigger.id));
}

/**
 * Enabled schedules of live agents that are due, across organizations, the
 * most overdue first: the minute cron's one scan for scheduled runs.
 */
async function dueSchedules(now: string, limit: number) {
  return db
    .select({
      ...triggerColumns(),
      organizationId: agentTrigger.organizationId,
    })
    .from(agentTrigger)
    .innerJoin(
      agentDefinition,
      and(
        eq(agentDefinition.id, agentTrigger.agentId),
        eq(agentDefinition.status, "LIVE"),
      ),
    )
    .where(
      and(
        eq(agentTrigger.enabled, true),
        eq(agentTrigger.type, "SCHEDULE"),
        lte(agentTrigger.nextRunAt, now),
      ),
    )
    .orderBy(asc(agentTrigger.nextRunAt), asc(agentTrigger.id))
    .limit(limit);
}

/**
 * Moves a schedule from the slot it was due at to the next one. False when
 * another tick moved it first (or it was turned off meanwhile).
 */
async function advanceSchedule(
  organizationId: string,
  id: string,
  from: string,
  next: string,
): Promise<boolean> {
  const rows = await db
    .update(agentTrigger)
    .set({ nextRunAt: next, lastRunAt: from, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentTrigger.organizationId, organizationId),
        eq(agentTrigger.id, id),
        eq(agentTrigger.enabled, true),
        eq(agentTrigger.nextRunAt, from),
      ),
    )
    .returning({ id: agentTrigger.id });
  return rows.length > 0;
}

/** Enabled triggers of live agents listening for `event`. */
async function eventTriggers(organizationId: string, event: CrmEventType) {
  return db
    .select(triggerColumns())
    .from(agentTrigger)
    .innerJoin(
      agentDefinition,
      and(
        eq(agentDefinition.id, agentTrigger.agentId),
        eq(agentDefinition.status, "LIVE"),
      ),
    )
    .where(
      and(
        eq(agentTrigger.organizationId, organizationId),
        eq(agentTrigger.event, event),
        eq(agentTrigger.enabled, true),
        eq(agentTrigger.type, "EVENT"),
      ),
    )
    .orderBy(asc(agentTrigger.id));
}

async function markTriggerRan(
  organizationId: string,
  id: string,
  at: string,
): Promise<void> {
  await db
    .update(agentTrigger)
    .set({ lastRunAt: at })
    .where(
      and(eq(agentTrigger.organizationId, organizationId), eq(agentTrigger.id, id)),
    );
}

/** Turns every trigger of the agent off (it was deleted). */
async function disableTriggers(
  organizationId: string,
  agentId: string,
): Promise<number> {
  const rows = await db
    .update(agentTrigger)
    .set({ enabled: false, nextRunAt: null })
    .where(
      and(
        eq(agentTrigger.organizationId, organizationId),
        eq(agentTrigger.agentId, agentId),
        eq(agentTrigger.enabled, true),
      ),
    )
    .returning({ id: agentTrigger.id });
  return rows.length;
}

// Files.

const artifactColumns = () => ({
  id: agentBuilderArtifact.id,
  conversationId: agentBuilderArtifact.conversationId,
  versionId: agentBuilderArtifact.versionId,
  path: agentBuilderArtifact.path,
  language: agentBuilderArtifact.language,
  content: agentBuilderArtifact.content,
  previousContent: agentBuilderArtifact.previousContent,
  revision: agentBuilderArtifact.revision,
  status: agentBuilderArtifact.status,
  createdAt: agentBuilderArtifact.createdAt,
});

export type ArtifactRow = Awaited<
  ReturnType<typeof versionFiles>
>[number];

/** The newest revision of each of `rows`' paths. */
function latestPerPath<Row extends { path: string; revision: number }>(
  rows: Row[],
): Row[] {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const held = latest.get(row.path);
    if (!held || row.revision > held.revision) latest.set(row.path, row);
  }
  return [...latest.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** A version's files, exactly as it was saved. */
async function versionFiles(organizationId: string, versionId: string) {
  const rows = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.versionId, versionId),
      ),
    );
  return latestPerPath(rows);
}

/** The newest revision of each file a builder chat wrote. */
async function conversationFiles(
  organizationId: string,
  conversationId: string,
) {
  const rows = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.conversationId, conversationId),
      ),
    );
  return latestPerPath(rows);
}

/**
 * Writes a working revision of a builder file, unless its newest revision
 * already says the same. The revision number is unique per chat and path, so
 * two writes racing for the next number can't both land.
 */
async function writeArtifact(input: {
  organizationId: string;
  conversationId: string;
  path: string;
  language: string;
  content: string;
}): Promise<{ id: string; revision: number }> {
  const [latest] = await db
    .select(artifactColumns())
    .from(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, input.organizationId),
        eq(agentBuilderArtifact.conversationId, input.conversationId),
        eq(agentBuilderArtifact.path, input.path),
      ),
    )
    .orderBy(desc(agentBuilderArtifact.revision))
    .limit(1);
  if (latest?.content === input.content) {
    return { id: latest.id, revision: latest.revision };
  }
  const row = {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    versionId: null,
    path: input.path,
    language: input.language,
    content: input.content,
    previousContent: latest?.content ?? null,
    revision: (latest?.revision ?? 0) + 1,
    status: "WRITING" as const,
  };
  await db.insert(agentBuilderArtifact).values(row);
  return { id: row.id, revision: row.revision };
}

/** A builder chat's working revisions no saved version kept. */
async function deleteUnsavedFiles(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db
    .delete(agentBuilderArtifact)
    .where(
      and(
        eq(agentBuilderArtifact.organizationId, organizationId),
        eq(agentBuilderArtifact.conversationId, conversationId),
        isNull(agentBuilderArtifact.versionId),
      ),
    );
}

// Audit.

async function findAudit(
  organizationId: string,
  agentId: string,
  type: string,
  requestId: string,
) {
  const [row] = await db
    .select({ id: agentAuditEvent.id, versionId: agentAuditEvent.versionId })
    .from(agentAuditEvent)
    .where(
      and(
        eq(agentAuditEvent.organizationId, organizationId),
        eq(agentAuditEvent.agentId, agentId),
        eq(agentAuditEvent.type, type),
        eq(agentAuditEvent.requestId, requestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Records an audit line; one with the same request id is recorded once. */
async function audit(event: NewAudit): Promise<void> {
  const insert = db.insert(agentAuditEvent).values(auditValues(event));
  await (event.requestId
    ? insert.onConflictDoNothing({
        target: [
          agentAuditEvent.agentId,
          agentAuditEvent.type,
          agentAuditEvent.requestId,
        ],
      })
    : insert);
}

/** The agent's activity: every change and run request, newest first. */
async function listAudit(organizationId: string, agentId: string, limit: number) {
  return db
    .select({
      id: agentAuditEvent.id,
      type: agentAuditEvent.type,
      summary: agentAuditEvent.summary,
      before: agentAuditEvent.before,
      after: agentAuditEvent.after,
      requestId: agentAuditEvent.requestId,
      actorType: agentAuditEvent.actorType,
      actorName: user.name,
      versionNumber: agentVersion.number,
      emittedAt: agentAuditEvent.emittedAt,
    })
    .from(agentAuditEvent)
    .leftJoin(user, eq(user.id, agentAuditEvent.actorUserId))
    .leftJoin(agentVersion, eq(agentVersion.id, agentAuditEvent.versionId))
    .where(
      and(
        eq(agentAuditEvent.organizationId, organizationId),
        eq(agentAuditEvent.agentId, agentId),
      ),
    )
    .orderBy(desc(agentAuditEvent.emittedAt), desc(agentAuditEvent.id))
    .limit(limit);
}

/** Live and paused agents whose deployed version posts to Slack. */
async function slackAgents(organizationId: string) {
  return db
    .select({
      id: agentDefinition.id,
      name: agentDefinition.name,
      description: agentDefinition.description,
      status: agentDefinition.status,
      manifest: agentVersion.manifest,
    })
    .from(agentDefinition)
    .innerJoin(
      agentVersion,
      eq(agentVersion.id, agentDefinition.currentVersionId),
    )
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        inArray(agentDefinition.status, ["LIVE", "PAUSED"]),
        isNotNull(agentDefinition.currentVersionId),
      ),
    )
    .orderBy(desc(agentDefinition.updatedAt))
    .limit(100);
}

export const TeamAgentRepository = {
  listVisible,
  findById,
  findByConversation,
  runCounts,
  enabledTriggers,
  transition,
  updateDetails,
  findVersion,
  latestVersion,
  saveVersion,
  deploy,
  replaceCurrentVersion,
  triggersForVersion,
  dueSchedules,
  advanceSchedule,
  eventTriggers,
  markTriggerRan,
  disableTriggers,
  versionFiles,
  conversationFiles,
  writeArtifact,
  deleteUnsavedFiles,
  findAudit,
  audit,
  listAudit,
  slackAgents,
};
