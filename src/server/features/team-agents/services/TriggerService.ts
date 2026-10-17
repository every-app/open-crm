import { TriggerRepository } from "@/server/features/team-agents/repositories/TriggerRepository";
import { scheduledResearchEnabled } from "@/server/lib/deployment-tier";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { CRM_EVENT_CATALOG, type CrmEventType } from "@/shared/team-agents";
import { AgentRunService } from "./AgentRunService";

// What starts a team agent without a person: its schedule, due on the minute
// cron, and the CRM events its EVENT triggers listen for, emitted where the
// records' services hand work to the agent queue (AgentTaskService.crmEvent).
// Ported from the CRM's queueDueAgentRuns and queueEventAgentRuns. Each makes
// a QUEUED run keyed by what caused it (the schedule slot, the event and the
// trigger), so a slot or an event delivered twice is one run.
//
// Both are unattended spending: a first-party deployment holding its
// scheduled research (FIRST_PARTY_SCHEDULED_RESEARCH=off) holds them too.

const SCHEDULE_BATCH = 20;

export type CrmEvent = {
  type: CrmEventType;
  recordId: string;
  data: Record<string, unknown>;
};

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
 * Queues a run for every live agent listening for this event: one per
 * trigger. How many runs it queued.
 */
async function emitEvent(
  organizationId: string,
  event: CrmEvent,
): Promise<number> {
  const triggers = await TriggerRepository.eventTriggers(
    organizationId,
    event.type,
  );
  if (triggers.length === 0) return 0;
  if (!scheduledResearchEnabled((await getWorkersEnv()) ?? {})) {
    console.log("[team-agents] event held", {
      organizationId,
      type: event.type,
    });
    return 0;
  }
  const eventId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  const record = {
    kind: CRM_EVENT_CATALOG[event.type].recordKind,
    id: event.recordId,
  };
  let queued = 0;
  for (const trigger of triggers) {
    const run = await AgentRunService.queueRun({
      organizationId,
      agentId: trigger.agentId,
      versionId: trigger.versionId,
      triggerId: trigger.id,
      triggerType: "EVENT",
      initiatedById: null,
      idempotencyKey: `event:${eventId}:trigger:${trigger.id}`,
      runInput: {
        event: { type: event.type, occurredAt, data: event.data },
        record,
      },
      requestedSummary: `${CRM_EVENT_CATALOG[event.type].label}: ${trigger.name}`,
    });
    if (!run?.created) continue;
    queued += 1;
    await TriggerRepository.markTriggerRan(
      organizationId,
      trigger.id,
      occurredAt,
    );
  }
  return queued;
}

export const TriggerService = {
  queueDueSchedules,
  emitEvent,
};
