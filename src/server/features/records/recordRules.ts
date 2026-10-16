import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  activity,
  agentEvent,
  agentTask,
  company,
  contact,
  deal,
} from "@/db/schema";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError, asAppError } from "@/server/lib/errors";
import type { BulkResult } from "@/types/schemas/records";

// Rules every record (company, contact, deal) follows: who may own it, how a
// bulk action reports, when its enrichment counts as queued, and what a purge
// has to clean up by hand.
//
// Archive and restore only set or clear `archived_at`: the record is hidden,
// not changed. Purge permanently deletes an archived record. The database
// cascades what has a foreign key; the agent's rows (agent_task, agent_event)
// carry record ids without one, so the purge clears them itself, and the
// records whose last activity came from the deleted activities are
// restamped once it's done.

// D1 binds at most 100 parameters per statement; id lists are cut below it.
const ID_CHUNK = 90;

/** The trimmed value, or null for a blank one: a cleared field is null. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Refuses an owner who isn't a member of the organization. */
export async function assertOwner(
  organizationId: string,
  ownerId: string | null | undefined,
): Promise<void> {
  if (!ownerId) return;
  if (!(await AuthRepository.isMember(organizationId, ownerId))) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That owner is not a member of this organization.",
    );
  }
}

/**
 * Whether a write hit a unique index (a live company's domain, a live
 * contact's email). Drizzle wraps the driver's error, so the cause chain is
 * checked: SQLite says so in the message, Postgres with code 23505.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes("UNIQUE constraint failed")) return true;
  if ("code" in error && error.code === "23505") return true;
  return isUniqueViolation(error.cause);
}

/**
 * Runs `act` for each record in turn. One record failing doesn't stop the
 * rest; the first failure's code says why.
 */
export async function runBulk(
  ids: string[],
  act: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  let succeeded = 0;
  let error: BulkResult["error"] = null;
  for (const id of unique) {
    try {
      await act(id);
      succeeded += 1;
    } catch (cause) {
      const appError = asAppError(cause);
      if (!appError) console.error("[records] bulk action failed", cause);
      error ??= appError?.code ?? "INTERNAL_ERROR";
    }
  }
  return {
    requested: unique.length,
    succeeded,
    failed: unique.length - succeeded,
    error,
  };
}

/**
 * The result of a set-based bulk write that reached `succeeded` records. The
 * others weren't the organization's, or weren't in a state the action takes.
 */
export function bulkOutcome(requested: number, succeeded: number): BulkResult {
  return {
    requested,
    succeeded,
    failed: requested - succeeded,
    error: succeeded < requested ? "NOT_FOUND" : null,
  };
}

/** Splits ids into lists D1 can bind in one statement. */
export function idChunks(ids: string[]): string[][] {
  return chunk([...new Set(ids)], ID_CHUNK);
}

/**
 * Of `ids`, the records with agent work waiting or running: an open task
 * that is due. Shown as "Queued" until the agent marks the record itself.
 */
export async function queuedRecordIds(
  organizationId: string,
  kind: "company" | "contact",
  ids: string[],
): Promise<Set<string>> {
  const column = kind === "company" ? agentTask.companyId : agentTask.contactId;
  const queued = new Set<string>();
  const now = new Date().toISOString();
  for (const part of idChunks(ids)) {
    const rows = await db
      .selectDistinct({ id: column })
      .from(agentTask)
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          inArray(column, part),
          isNull(agentTask.finishedAt),
          lte(agentTask.dueAt, now),
        ),
      );
    for (const row of rows) if (row.id) queued.add(row.id);
  }
  return queued;
}

type AgentRecordColumns = {
  companyId: AnyColumn;
  contactId: AnyColumn;
  dealId: AnyColumn;
};

/**
 * The statements that clear the agent's queue and journal rows about a
 * record being purged, for its runBatch. `about` picks the rows; `guard` is
 * the purge's own condition, so they stay unless the record really goes.
 */
export function clearAgentRows(
  tx: typeof db,
  organizationId: string,
  about: (row: AgentRecordColumns) => SQL,
  guard: SQL,
) {
  return [
    tx
      .delete(agentTask)
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          about(agentTask),
          guard,
        ),
      ),
    tx
      .delete(agentEvent)
      .where(
        and(
          eq(agentEvent.organizationId, organizationId),
          about(agentEvent),
          guard,
        ),
      ),
  ];
}

export type ActivityTargets = {
  companyIds: string[];
  contactIds: string[];
  dealIds: string[];
};

/**
 * The records the activities matching `where` are filed on. Read before a
 * purge deletes them, so their last activity can be restamped after.
 */
export async function activityTargets(
  organizationId: string,
  where: SQL,
): Promise<ActivityTargets> {
  const rows = await db
    .selectDistinct({
      companyId: activity.companyId,
      contactId: activity.contactId,
      dealId: activity.dealId,
    })
    .from(activity)
    .where(and(eq(activity.organizationId, organizationId), where));
  const ids = (key: keyof (typeof rows)[number]) => [
    ...new Set(rows.flatMap((row) => (row[key] ? [row[key]] : []))),
  ];
  return {
    companyIds: ids("companyId"),
    contactIds: ids("contactId"),
    dealIds: ids("dealId"),
  };
}

/**
 * Restamps `last_activity_at` on `targets` from the activities they still
 * have. Runs after a purge, which has already happened, so a failure is
 * logged rather than thrown.
 */
export async function recomputeLastActivity(
  organizationId: string,
  targets: ActivityTargets,
): Promise<void> {
  try {
    for (const ids of idChunks(targets.companyIds)) {
      await db
        .update(company)
        .set({
          lastActivityAt: sql`(select max(${activity.createdAt}) from ${activity} where ${activity.companyId} = ${company.id})`,
        })
        .where(
          and(
            eq(company.organizationId, organizationId),
            inArray(company.id, ids),
          ),
        );
    }
    for (const ids of idChunks(targets.contactIds)) {
      await db
        .update(contact)
        .set({
          lastActivityAt: sql`(select max(${activity.createdAt}) from ${activity} where ${activity.contactId} = ${contact.id})`,
        })
        .where(
          and(
            eq(contact.organizationId, organizationId),
            inArray(contact.id, ids),
          ),
        );
    }
    for (const ids of idChunks(targets.dealIds)) {
      await db
        .update(deal)
        .set({
          lastActivityAt: sql`(select max(${activity.createdAt}) from ${activity} where ${activity.dealId} = ${deal.id})`,
        })
        .where(
          and(eq(deal.organizationId, organizationId), inArray(deal.id, ids)),
        );
    }
  } catch (error) {
    console.error(
      "[records] a purge went through but last activity was not restamped",
      { organizationId },
      error,
    );
  }
}
