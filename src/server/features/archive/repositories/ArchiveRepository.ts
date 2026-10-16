import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  activity,
  agentEvent,
  agentTask,
  company,
  contact,
  deal,
  suppressedContact,
} from "@/db/schema";

// Purging: a company, contact or deal archived longer than its workspace
// keeps archives is deleted for good. The database cascades what hangs off
// it (deals of a company, activities, field values, conversations); the rest
// goes in the same batch, and only while the record is still archived past
// the cutoff, so a restore that lands first wins:
// - the agent's queued work about it (agent_task has no foreign keys),
// - a contact's agent events, and its address onto the suppression list, so
//   captured mail never brings the person back.

export type ArchivedKind = "company" | "contact" | "deal";

export type ActivityTargets = {
  companyIds: string[];
  contactIds: string[];
  dealIds: string[];
};

const RECORDS = { company, contact, deal };

/**
 * Up to `limit` of the organization's `kind` records archived at or before
 * `before`, longest-archived first.
 */
async function expiredIds(
  organizationId: string,
  kind: ArchivedKind,
  before: string,
  limit: number,
): Promise<string[]> {
  const table = RECORDS[kind];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(expired(table, organizationId, before))
    .orderBy(asc(table.archivedAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

function expired(
  table: (typeof RECORDS)[ArchivedKind],
  organizationId: string,
  before: string,
  ids?: string[],
): SQL | undefined {
  return and(
    eq(table.organizationId, organizationId),
    ids ? inArray(table.id, ids) : undefined,
    isNotNull(table.archivedAt),
    lte(table.archivedAt, before),
  );
}

/**
 * Organizations with any record archived at or before `before`: the ones a
 * retention sweep may have something to purge for.
 */
async function organizationsArchivedBefore(before: string): Promise<string[]> {
  const found = new Set<string>();
  for (const table of Object.values(RECORDS)) {
    const rows = await db
      .selectDistinct({ organizationId: table.organizationId })
      .from(table)
      .where(and(isNotNull(table.archivedAt), lte(table.archivedAt, before)));
    for (const row of rows) found.add(row.organizationId);
  }
  return [...found];
}

/**
 * Deletes the given archived records of `kind` that are still archived at
 * or before `before`, with what the database doesn't cascade. The ids
 * deleted.
 */
async function purge(
  organizationId: string,
  kind: ArchivedKind,
  ids: string[],
  before: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const table = RECORDS[kind];
  const now = new Date().toISOString();
  await runBatch((tx) => {
    const purged = tx
      .select({ id: table.id })
      .from(table)
      .where(expired(table, organizationId, before, ids));
    const ofOrganization = eq(agentTask.organizationId, organizationId);

    if (kind === "company") {
      const theirDeals = tx
        .select({ id: deal.id })
        .from(deal)
        .where(
          and(
            eq(deal.organizationId, organizationId),
            inArray(deal.companyId, purged),
          ),
        );
      return [
        tx
          .delete(agentTask)
          .where(
            and(
              ofOrganization,
              or(
                inArray(agentTask.companyId, purged),
                inArray(agentTask.dealId, theirDeals),
              ),
            ),
          ),
        tx.delete(company).where(expired(company, organizationId, before, ids)),
      ];
    }
    if (kind === "deal") {
      return [
        tx
          .delete(agentTask)
          .where(and(ofOrganization, inArray(agentTask.dealId, purged))),
        tx.delete(deal).where(expired(deal, organizationId, before, ids)),
      ];
    }
    return [
      tx
        .delete(agentTask)
        .where(and(ofOrganization, inArray(agentTask.contactId, purged))),
      tx
        .delete(agentEvent)
        .where(
          and(
            eq(agentEvent.organizationId, organizationId),
            inArray(agentEvent.contactId, purged),
          ),
        ),
      tx
        .insert(suppressedContact)
        .select((qb) =>
          qb
            .select({
              organizationId: contact.organizationId,
              email: sql<string>`lower(trim(${contact.email}))`,
              reason: sql<string>`'Deleted from the CRM (' || ${contact.firstName} || coalesce(' ' || nullif(${contact.lastName}, ''), '') || ')'`,
              createdAt: sql<string>`${now}`,
            })
            .from(contact)
            .where(
              and(
                expired(contact, organizationId, before, ids),
                sql`trim(coalesce(${contact.email}, '')) <> ''`,
              ),
            )
            // Typed as SQL, so the expressions needn't type as columns; the
            // selection follows suppressed_contact's column order.
            .getSQL(),
        )
        .onConflictDoNothing(),
      tx.delete(contact).where(expired(contact, organizationId, before, ids)),
    ];
  });

  const remaining = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(eq(table.organizationId, organizationId), inArray(table.id, ids)),
    );
  const kept = new Set(remaining.map((row) => row.id));
  return ids.filter((id) => !kept.has(id));
}

/**
 * The records sharing activities with the given ones, whose last-activity
 * time may change once those activities are deleted with them.
 */
async function activityTargets(
  organizationId: string,
  kind: ArchivedKind,
  ids: string[],
): Promise<ActivityTargets> {
  const empty = { companyIds: [], contactIds: [], dealIds: [] };
  if (ids.length === 0) return empty;
  const about =
    kind === "company"
      ? or(
          inArray(activity.companyId, ids),
          inArray(
            activity.dealId,
            db
              .select({ id: deal.id })
              .from(deal)
              .where(
                and(
                  eq(deal.organizationId, organizationId),
                  inArray(deal.companyId, ids),
                ),
              ),
          ),
        )
      : inArray(kind === "contact" ? activity.contactId : activity.dealId, ids);
  const rows = await db
    .selectDistinct({
      companyId: activity.companyId,
      contactId: activity.contactId,
      dealId: activity.dealId,
    })
    .from(activity)
    .where(and(eq(activity.organizationId, organizationId), about));
  return {
    companyIds: present(rows.map((row) => row.companyId)),
    contactIds: present(rows.map((row) => row.contactId)),
    dealIds: present(rows.map((row) => row.dealId)),
  };
}

function present(values: (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];
}

const RESTAMP_CHUNK = 90;

/**
 * Sets each record's last-activity time to its newest remaining activity
 * (null when none is left).
 */
async function restamp(
  organizationId: string,
  targets: ActivityTargets,
): Promise<void> {
  const groups = [
    { table: company, ids: targets.companyIds, column: activity.companyId },
    { table: contact, ids: targets.contactIds, column: activity.contactId },
    { table: deal, ids: targets.dealIds, column: activity.dealId },
  ];
  for (const { table, ids, column } of groups) {
    for (let start = 0; start < ids.length; start += RESTAMP_CHUNK) {
      await db
        .update(table)
        .set({
          lastActivityAt: sql<
            string | null
          >`(select max(${activity.createdAt}) from ${activity} where ${activity.organizationId} = ${organizationId} and ${column} = ${table.id})`,
        })
        .where(
          and(
            eq(table.organizationId, organizationId),
            inArray(table.id, ids.slice(start, start + RESTAMP_CHUNK)),
          ),
        );
    }
  }
}

export const ArchiveRepository = {
  expiredIds,
  organizationsArchivedBefore,
  purge,
  activityTargets,
  restamp,
};
