import {
  and,
  count,
  eq,
  getTableColumns,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  notExists,
  type Column,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import * as schema from "@/db/schema";
import {
  activity,
  agentAction,
  agentConversation,
  agentDefinition,
  agentEvent,
  agentRun,
  agentTask,
  agentTrigger,
  agentVersion,
  calendarAttendee,
  contactFact,
  deal,
  emailMessage,
  fieldValue,
  formSubmission,
  mailboxSync,
  member,
  organization,
  trackedEvent,
  trackingSite,
  user,
  workspace,
} from "@/db/schema";
import { idChunks } from "@/server/features/records/recordRules";

// The database side of erasing one organization (OrganizationErasureService).
// Every function takes the organization and touches only its rows, but the
// last, which deletes the people who belonged to no other organization.

/** Every table with an `organization_id`, from the schema itself. */
function organizationTables() {
  return Object.values(schema).flatMap((table) => {
    const columns: Record<string, Column> = getTableColumns(table);
    const organizationId = columns.organizationId;
    return organizationId ? [{ table, organizationId }] : [];
  });
}

/** How many rows each of the organization's tables holds, the empty left out. */
async function rowCounts(organizationId: string) {
  const counts: Record<string, number> = {};
  for (const { table, organizationId: column } of organizationTables()) {
    const [row] = await db
      .select({ value: count() })
      .from(table)
      .where(eq(column, organizationId));
    if (row && row.value > 0) counts[getTableName(table)] = row.value;
  }
  return counts;
}

async function organizationExists(organizationId: string) {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return row !== undefined;
}

/** The organization's members, with how many other organizations each is in. */
async function members(organizationId: string) {
  const others = db
    .select({ userId: member.userId, value: count().as("value") })
    .from(member)
    .groupBy(member.userId)
    .as("others");
  return db
    .select({
      userId: member.userId,
      email: user.email,
      role: member.role,
      lastSeenAt: member.lastSeenAt,
      memberships: others.value,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(others, eq(others.userId, member.userId))
    .where(eq(member.organizationId, organizationId));
}

/**
 * Stops the work that would write more of the organization while it is
 * erased: the enrichment sweep (it starts from the workspace row), mailbox
 * checks, the tracking collector (it starts from the site), team agents'
 * schedules and events, open research and queued runs.
 */
async function freeze(organizationId: string) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx.delete(workspace).where(eq(workspace.organizationId, organizationId)),
    tx
      .delete(mailboxSync)
      .where(eq(mailboxSync.organizationId, organizationId)),
    tx
      .delete(trackingSite)
      .where(eq(trackingSite.organizationId, organizationId)),
    tx
      .delete(agentTrigger)
      .where(eq(agentTrigger.organizationId, organizationId)),
    tx
      .update(agentTask)
      .set({ finishedAt: now, outcome: "erased" })
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          isNull(agentTask.finishedAt),
        ),
      ),
    tx
      .update(agentRun)
      .set({ status: "CANCELLED", finishedAt: now })
      .where(
        and(
          eq(agentRun.organizationId, organizationId),
          eq(agentRun.status, "QUEUED"),
        ),
      ),
  ]);
}

const SESSION_SOURCES = () => [
  { table: agentConversation, column: agentConversation.sessionId },
  { table: agentRun, column: agentRun.sessionId },
  { table: agentTask, column: agentTask.sessionId },
  { table: agentEvent, column: agentEvent.sessionId },
];

/**
 * Up to `limit` names of the organization's agent sessions (each a CrmAgent
 * Durable Object) that rows still name: chats, research tasks, runs, and
 * whatever the journal remembers.
 */
async function sessionNames(organizationId: string, limit: number) {
  const names = new Set<string>();
  for (const { table, column } of SESSION_SOURCES()) {
    if (names.size >= limit) break;
    const rows = await db
      .selectDistinct({ name: column })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), isNotNull(column)))
      .limit(limit - names.size);
    for (const row of rows) if (row.name) names.add(row.name);
  }
  return [...names];
}

/** Forgets the rows that name these sessions, once they are destroyed. */
async function forgetSessions(organizationId: string, names: string[]) {
  for (const part of idChunks(names)) {
    await runBatch((tx) =>
      SESSION_SOURCES().map(({ table, column }) =>
        tx
          .delete(table)
          .where(
            and(
              eq(table.organizationId, organizationId),
              inArray(column, part),
            ),
          ),
      ),
    );
  }
}

/** The tables that grow largest, none referenced by another. */
const HEAVY = () => [
  trackedEvent,
  agentEvent,
  agentTask,
  agentAction,
  emailMessage,
  activity,
  fieldValue,
  contactFact,
  calendarAttendee,
  formSubmission,
];

/**
 * Deletes up to `limit` rows of each heavy table, so the organization's own
 * delete never cascades through all of them in one statement. Whether
 * anything was left.
 */
async function deleteHeavyBatch(organizationId: string, limit: number) {
  let more = false;
  for (const table of HEAVY()) {
    const ids = db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.organizationId, organizationId))
      .limit(limit);
    const removed = await db
      .delete(table)
      .where(inArray(table.id, ids))
      .returning({ id: table.id });
    if (removed.length === limit) more = true;
  }
  return more;
}

/**
 * Deletes the organization, which cascades to every row of it, and in the
 * same batch the users who were members of no other organization, unless
 * another organization's deal or agent still names them: how many went, and
 * how many were kept for that.
 */
async function deleteOrganization(organizationId: string) {
  // Its members who are in no other organization.
  const users = (await members(organizationId))
    .filter((one) => one.memberships === 1)
    .map((one) => one.userId);
  const orphan = (ids: string[]) =>
    and(
      inArray(user.id, ids),
      notExists(
        db
          .select({ id: member.id })
          .from(member)
          .where(eq(member.userId, user.id)),
      ),
      notExists(
        db.select({ id: deal.id }).from(deal).where(eq(deal.ownerId, user.id)),
      ),
      notExists(
        db
          .select({ id: agentDefinition.id })
          .from(agentDefinition)
          .where(eq(agentDefinition.createdById, user.id)),
      ),
      notExists(
        db
          .select({ id: agentVersion.id })
          .from(agentVersion)
          .where(eq(agentVersion.createdById, user.id)),
      ),
    );
  await runBatch((tx) => [
    tx.delete(organization).where(eq(organization.id, organizationId)),
    ...idChunks(users).map((ids) => tx.delete(user).where(orphan(ids))),
  ]);
  let remaining = 0;
  for (const ids of idChunks(users)) {
    const [row] = await db
      .select({ value: count() })
      .from(user)
      .where(inArray(user.id, ids));
    remaining += row?.value ?? 0;
  }
  return { erased: users.length - remaining, kept: remaining };
}

export const ErasureRepository = {
  rowCounts,
  organizationExists,
  members,
  freeze,
  sessionNames,
  forgetSessions,
  deleteHeavyBatch,
  deleteOrganization,
};
