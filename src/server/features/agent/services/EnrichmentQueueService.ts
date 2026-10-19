import { MAX_ATTEMPTS } from "@/shared/agent-tasks";
import { fullName } from "../lib/names";
import { EnrichmentQueueRepository } from "../repositories/EnrichmentQueueRepository";
import {
  AgentAvailabilityService,
  taskHold,
  type ResearchHold,
} from "./AgentAvailabilityService";

// What the research agent is working on for the organization and what it has
// booked for later, for the enrichment queue on Home. Ported from the CRM's
// EnrichmentService.queue; the client words each row (enrichmentCopy.ts).

type QueueSubject =
  | { kind: "contact"; id: string; name: string; imageUrl: string | null }
  | {
      kind: "company";
      id: string;
      name: string;
      logoUrl: string | null;
      logoDarkUrl: string | null;
      logoTone: string | null;
    }
  | { kind: "deal"; id: string; name: string };

/**
 * Running under a live lease, waiting its turn, out of attempts, or waiting
 * for the agent's model to be set up.
 */
type QueueState = "running" | "queued" | "failed" | "waiting";

type Task = Awaited<
  ReturnType<typeof EnrichmentQueueRepository.due>
>["tasks"][number];

function stateOf(task: Task, now: string, hold: ResearchHold): QueueState {
  if (task.leasedUntil !== null && task.leasedUntil > now) return "running";
  if (task.attempts >= MAX_ATTEMPTS) return "failed";
  return taskHold(task, hold) === "setup" ? "waiting" : "queued";
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/**
 * The organization's open tasks about its records: those due now (`rows`,
 * most urgent first, `limit` of `total`) and those booked for later
 * (`scheduled`, soonest first, `limit` of `scheduledTotal`). A task whose
 * record is gone is counted but not listed, as in the CRM. `paused`: the
 * agent's model isn't set up, so its research waits.
 */
async function queue(organizationId: string, limit: number) {
  const now = new Date().toISOString();
  const hold = await AgentAvailabilityService.researchHold(organizationId);
  const [due, booked] = await Promise.all([
    EnrichmentQueueRepository.due(organizationId, now, limit, hold.minPriority),
    EnrichmentQueueRepository.booked(organizationId, now, limit),
  ]);
  const tasks = [...due.tasks, ...booked.tasks];
  const records = await EnrichmentQueueRepository.records(organizationId, {
    contactIds: unique(tasks.map((task) => task.contactId)),
    companyIds: unique(tasks.map((task) => task.companyId)),
    dealIds: unique(tasks.map((task) => task.dealId)),
  });
  const subjects = new Map<string, QueueSubject>();
  for (const row of records.contacts) {
    subjects.set(`contact:${row.id}`, {
      kind: "contact",
      id: row.id,
      name: fullName(row) || row.email || "Unnamed contact",
      imageUrl: row.imageUrl,
    });
  }
  for (const row of records.companies) {
    subjects.set(`company:${row.id}`, {
      kind: "company",
      id: row.id,
      name: row.name,
      logoUrl: row.iconUrl ?? row.logoUrl,
      logoDarkUrl: row.iconDarkUrl ?? row.logoDarkUrl,
      logoTone: row.iconTone,
    });
  }
  for (const row of records.deals) {
    subjects.set(`deal:${row.id}`, {
      kind: "deal",
      id: row.id,
      name: row.name,
    });
  }
  const subjectOf = (task: Task) =>
    subjects.get(
      task.contactId
        ? `contact:${task.contactId}`
        : task.companyId
          ? `company:${task.companyId}`
          : `deal:${task.dealId}`,
    );

  return {
    rows: due.tasks.flatMap((task) => {
      const subject = subjectOf(task);
      return subject
        ? [
            {
              id: task.id,
              kind: task.kind,
              state: stateOf(task, now, hold),
              startedAt: task.startedAt,
              subject,
            },
          ]
        : [];
    }),
    total: due.total,
    paused: hold.paused,
    scheduled: booked.tasks.flatMap((task) => {
      const subject = subjectOf(task);
      return subject
        ? [
            {
              id: task.id,
              kind: task.kind,
              dueAt: task.dueAt,
              reason: task.reason,
              subject,
            },
          ]
        : [];
    }),
    scheduledTotal: booked.total,
  };
}

export const EnrichmentQueueService = { queue };
