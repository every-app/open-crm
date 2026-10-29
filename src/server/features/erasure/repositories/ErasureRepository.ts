import {
  count,
  eq,
  getTableColumns,
  getTableName,
  inArray,
  type Column,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import * as schema from "@/db/schema";
import {
  activity,
  agentAction,
  agentEvent,
  agentTask,
  calendarAttendee,
  contactFact,
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
// Every function takes the organization and touches only its rows and its
// members.

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

/** The organization's members. */
async function members(organizationId: string) {
  return db
    .select({
      userId: member.userId,
      email: user.email,
      role: member.role,
      lastSeenAt: member.lastSeenAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));
}

/**
 * Stops the work that would write more of the organization while it is
 * erased: mailbox checks and the tracking collector (it starts from the
 * site).
 */
async function freeze(organizationId: string) {
  await runBatch((tx) => [
    tx.delete(workspace).where(eq(workspace.organizationId, organizationId)),
    tx
      .delete(mailboxSync)
      .where(eq(mailboxSync.organizationId, organizationId)),
    tx
      .delete(trackingSite)
      .where(eq(trackingSite.organizationId, organizationId)),
  ]);
}

/**
 * The tables that grow largest, none referenced by another. agent_event,
 * agent_task and agent_action are retired with the research agent and team
 * agents, and still hold their rows until they are dropped.
 */
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
 * same batch its members' users: a deployment serves one organization, so
 * nobody else names them. How many users went.
 */
async function deleteOrganization(organizationId: string) {
  const users = (await members(organizationId)).map((one) => one.userId);
  await runBatch((tx) => [
    tx.delete(organization).where(eq(organization.id, organizationId)),
    ...idChunks(users).map((ids) =>
      tx.delete(user).where(inArray(user.id, ids)),
    ),
  ]);
  return users.length;
}

export const ErasureRepository = {
  rowCounts,
  organizationExists,
  members,
  freeze,
  deleteHeavyBatch,
  deleteOrganization,
};
