import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { agentDefinition, agentTrigger } from "@/db/schema";
import type { CrmEventType, TriggerType } from "@/shared/team-agents";

// When team agents run (agent_trigger): a version's triggers, the minute
// cron's scan for due schedules, and the triggers listening for a CRM event.
// Scoped to the organization, except the cron's scan, which returns the
// organization of every trigger it hands back.

const ID_CHUNK = 90;

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
    .set({
      nextRunAt: next,
      lastRunAt: from,
      updatedAt: new Date().toISOString(),
    })
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
      and(
        eq(agentTrigger.organizationId, organizationId),
        eq(agentTrigger.id, id),
      ),
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

export const TriggerRepository = {
  enabledTriggers,
  triggersForVersion,
  dueSchedules,
  advanceSchedule,
  eventTriggers,
  markTriggerRan,
  disableTriggers,
};
