import { and, eq, inArray, not, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/db";
import { agentTask } from "@/db/schema";
import { AGENT_EVENT_KIND, PRIORITY } from "@/shared/agent-tasks";
import {
  CRM_EVENT_CATALOG,
  CRM_EVENT_TYPES,
  type CrmEventType,
} from "@/shared/team-agents";

// CRM events for the team agents, ported from the CRM's withCrmEvents: each
// is an agent-event task in the agent queue, written in the batch of the
// record write that caused it, so it commits exactly when the record does.
// TriggerService turns pending ones into runs.

/**
 * A CRM event as the write that causes it emits it (the CRM's crm-events):
 * its type and the data the runs it starts read. The write adds which record
 * and when.
 */
export type CrmEvent = { type: CrmEventType; data: Record<string, unknown> };

/** An agent-event task's payload, as the CRM's crmEventTask reads it. */
export const crmEventPayload = z
  .object({
    type: z.enum(CRM_EVENT_TYPES),
    record: z.object({
      kind: z.string().trim(),
      id: z.string().trim().min(1),
    }),
    occurredAt: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !Number.isNaN(new Date(value).getTime())),
    data: z.record(z.string(), z.json()).catch({}),
  })
  .refine(
    (event) => CRM_EVENT_CATALOG[event.type].recordKind === event.record.kind,
  );

/**
 * The statements that queue CRM events about one record, for the batch that
 * writes it, as of `occurredAt` (now, unless the write has its own time).
 * Each event is its own task with no subject, so a record can have any
 * number open. With `landed`, a condition true once the write took effect,
 * the batch takes them back out when it didn't (a stage move someone else
 * made first).
 */
export function queueCrmEvents(
  tx: typeof db,
  input: {
    organizationId: string;
    recordId: string;
    events: readonly CrmEvent[];
    occurredAt?: string;
    landed?: SQL;
  },
) {
  const { organizationId, recordId } = input;
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const rows = input.events.map((event) => {
    const kind = CRM_EVENT_CATALOG[event.type].recordKind;
    return {
      id: crypto.randomUUID(),
      organizationId,
      kind: AGENT_EVENT_KIND,
      reason: event.type,
      payload: {
        type: event.type,
        record: { kind, id: recordId },
        occurredAt,
        data: event.data,
      },
      priority: PRIORITY.event,
      budget: 1,
      contactId: kind === "contact" ? recordId : null,
      companyId: kind === "company" ? recordId : null,
      dealId: kind === "deal" ? recordId : null,
      dueAt: occurredAt,
    };
  });
  if (rows.length === 0) return [];
  const queued = tx.insert(agentTask).values(rows);
  if (!input.landed) return [queued];
  return [
    queued,
    tx.delete(agentTask).where(
      and(
        eq(agentTask.organizationId, organizationId),
        inArray(
          agentTask.id,
          rows.map((row) => row.id),
        ),
        not(input.landed),
      ),
    ),
  ];
}
