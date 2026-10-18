import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { agentTask } from "@/db/schema";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AGENT_EVENT_KIND } from "@/shared/agent-tasks";
import {
  AgentAvailabilityService,
  taskHold,
} from "@/server/features/agent/services/AgentAvailabilityService";
import { AppError, asAppError } from "@/server/lib/errors";
import type { BulkResult } from "@/types/schemas/records";

// Rules every record (company, contact, deal) follows: who may own it, how a
// bulk action reports, and when its enrichment counts as queued or waiting.
//
// Archive and restore only set or clear `archived_at`: the record is hidden,
// not changed. Purge permanently deletes an archived record, the same way
// whether a person or the retention sweep does it
// (ArchiveService.purgeArchived).

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
 * contact's email, a field's key, a saved view's name). Drizzle wraps the driver's error, so the cause chain is
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
 * Of `ids`, the records the agent is on (`queued`: an open, due task that
 * can run, shown as "Queued" until the agent marks the record itself) and
 * those whose research, due or booked for later, waits for the model to be
 * set up (`waiting`). A task
 * a first-party deployment holds to work a person asked for is neither: the
 * record reads as not researched, and "Re-enrich" runs it.
 */
export async function recordAgentStates(
  organizationId: string,
  kind: "company" | "contact",
  ids: string[],
): Promise<{ queued: Set<string>; waiting: Set<string> }> {
  const column = kind === "company" ? agentTask.companyId : agentTask.contactId;
  const queued = new Set<string>();
  const waiting = new Set<string>();
  if (ids.length === 0) return { queued, waiting };
  const hold = await AgentAvailabilityService.researchHold(organizationId);
  const now = new Date().toISOString();
  for (const part of idChunks(ids)) {
    const rows = await db
      .select({
        id: column,
        kind: agentTask.kind,
        priority: agentTask.priority,
        dueAt: agentTask.dueAt,
      })
      .from(agentTask)
      .where(
        and(
          eq(agentTask.organizationId, organizationId),
          inArray(column, part),
          isNull(agentTask.finishedAt),
          // A CRM event is the team agents' to handle, not research.
          ne(agentTask.kind, AGENT_EVENT_KIND),
        ),
      );
    for (const row of rows) {
      if (!row.id) continue;
      const held = taskHold(row, hold);
      if (held === "setup") waiting.add(row.id);
      else if (held === null && row.dueAt <= now) queued.add(row.id);
    }
  }
  for (const id of queued) waiting.delete(id);
  return { queued, waiting };
}
