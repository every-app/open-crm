import {
  AgentQueueRepository,
  type LeasedTask,
} from "@/server/features/agent/repositories/AgentQueueRepository";
import { AgentTaskRepository } from "@/server/features/agent/repositories/AgentTaskRepository";
import { crmEventPayload } from "@/server/features/team-agents/repositories/CrmEventRepository";
import { TriggerRepository } from "@/server/features/team-agents/repositories/TriggerRepository";
import { AGENT_EVENT_KIND } from "@/shared/agent-tasks";
import { CRM_EVENT_CATALOG } from "@/shared/team-agents";
import { AgentRunService } from "./AgentRunService";

// What starts a team agent without a person: its schedule, due on the minute
// cron, and the CRM events its EVENT triggers listen for. Ported from the
// CRM's queueDueAgentRuns and queueEventAgentRuns. A record's write queues
// each event it causes as an agent-event task in its own batch
// (CrmEventRepository), so an event exists exactly when its record write
// landed; the minute cron, and a poke after the write, turn those into runs
// here. Each run is keyed by what caused it (the schedule slot, or the event
// and the trigger), so a slot or an event handled twice is one run.
//
// Both are unattended spending: a first-party deployment holding its
// scheduled research (FIRST_PARTY_SCHEDULED_RESEARCH=off) holds them too.

const SCHEDULE_BATCH = 20;

/**
 * CRM events taken at a time (on the minute cron, at most `perOrganization`
 * of them an organization's), and how long one is held while it's handled.
 */
const EVENTS = { batch: 50, perOrganization: 10, leaseMs: 5 * 60_000 } as const;

const HELD_OUTCOME =
  "No runs: this deployment holds unattended runs with its scheduled research.";

/** The next slot after `from` that is still in the future. */
export function nextSlot(
  from: string,
  intervalMinutes: number,
  now: Date,
): string {
  const intervalMs = intervalMinutes * 60_000;
  const start = Date.parse(from);
  const missed = Math.max(
    1,
    Math.floor((now.getTime() - start) / intervalMs) + 1,
  );
  return new Date(start + missed * intervalMs).toISOString();
}

/**
 * Queues one run for each due schedule and moves it to its next slot. Across
 * organizations, a batch per tick. Two ticks that overlap make one run per
 * slot: the run is keyed by the slot, and only one tick moves it.
 */
async function queueDueSchedules(now = new Date()): Promise<number> {
  const due = await TriggerRepository.dueSchedules(
    now.toISOString(),
    SCHEDULE_BATCH,
  );
  let queued = 0;
  for (const trigger of due) {
    if (!trigger.nextRunAt) continue;
    const slot = trigger.nextRunAt;
    const run = await AgentRunService.queueRun({
      organizationId: trigger.organizationId,
      agentId: trigger.agentId,
      versionId: trigger.versionId,
      triggerId: trigger.id,
      triggerType: "SCHEDULE",
      initiatedById: null,
      idempotencyKey: `schedule:${trigger.id}:${slot}`,
      runInput: { scheduledFor: slot },
      requestedSummary: `Scheduled run (${trigger.name})`,
    });
    await TriggerRepository.advanceSchedule(
      trigger.organizationId,
      trigger.id,
      slot,
      nextSlot(slot, trigger.intervalMinutes ?? 1_440, now),
    );
    if (run?.created) queued += 1;
  }
  return queued;
}

/**
 * Queues a run of every live agent listening for the event an agent-event
 * task holds: one per trigger, keyed by the task and the trigger. How many
 * runs the event has.
 */
async function runsForEvent(task: LeasedTask): Promise<number> {
  const parsed = crmEventPayload.safeParse(task.payload);
  if (!parsed.success) throw new Error("The queued agent event is invalid.");
  const { type, occurredAt, data } = parsed.data;
  const kind = CRM_EVENT_CATALOG[type].recordKind;
  const recordId = {
    contact: task.contactId,
    company: task.companyId,
    deal: task.dealId,
  }[kind];
  if (recordId !== parsed.data.record.id) {
    throw new Error("The queued agent event is invalid.");
  }
  const { organizationId } = task;
  const triggers = await TriggerRepository.eventTriggers(organizationId, type);
  let runs = 0;
  for (const trigger of triggers) {
    const run = await AgentRunService.queueRun({
      organizationId,
      agentId: trigger.agentId,
      versionId: trigger.versionId,
      triggerId: trigger.id,
      triggerType: "EVENT",
      initiatedById: null,
      idempotencyKey: `event:${task.id}:trigger:${trigger.id}`,
      runInput: {
        event: { type, occurredAt, data },
        record: { kind, id: recordId },
      },
      requestedSummary: `${CRM_EVENT_CATALOG[type].label}: ${trigger.name}`,
    });
    if (!run) continue;
    runs += 1;
    if (run.created) {
      await TriggerRepository.markTriggerRan(
        organizationId,
        trigger.id,
        occurredAt,
      );
    }
  }
  return runs;
}

/**
 * Turns queued CRM events into runs and closes them: across organizations
 * for the minute cron, or one organization's for a poke after a record
 * write. `held` (a deployment holding unattended runs) closes them with
 * none. An event that fails keeps its lease and is tried again when the
 * lease runs out, like any task. How many runs the events queued.
 */
async function queueEventRuns(options: {
  organizationId?: string;
  held: boolean;
}): Promise<number> {
  const tasks = await AgentQueueRepository.claimDue({
    limit: EVENTS.batch,
    perOrganization: options.organizationId
      ? undefined
      : EVENTS.perOrganization,
    lane: { only: [AGENT_EVENT_KIND] },
    leaseMs: EVENTS.leaseMs,
    organizationId: options.organizationId,
  });
  let queued = 0;
  for (const task of tasks) {
    try {
      const runs = options.held ? 0 : await runsForEvent(task);
      await AgentTaskRepository.complete(
        task.organizationId,
        task.id,
        options.held
          ? HELD_OUTCOME
          : runs === 1
            ? "Queued 1 matching agent run."
            : `Queued ${runs} matching agent runs.`,
      );
      queued += runs;
    } catch (error) {
      console.error(
        "[team-agents] could not queue an event's runs",
        { taskId: task.id, type: task.reason },
        error,
      );
    }
  }
  return queued;
}

export const TriggerService = {
  queueDueSchedules,
  queueEventRuns,
};
