import { and, asc, eq, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { agentDefinition, agentRun } from "@/db/schema";

// The team-agent dispatcher's scans (runtime/dispatch.ts): queued runs to
// start, runs that overran or never got going, queued runs of agents that
// stopped. The one place run reads span organizations: each returns the
// organization of every run it hands back.

/**
 * Queued runs of live agents with nothing running: the next runs to start,
 * each agent's oldest. Organizations take turns, oldest first within each,
 * at most `perOrganization` runs each.
 */
async function queuedAcrossOrganizations(input: {
  limit: number;
  perOrganization: number;
  organizationId?: string;
}) {
  const otherRun = alias(agentRun, "other_run");
  const startable = db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      versionId: agentRun.versionId,
      createdAt: agentRun.createdAt,
      agentTurn:
        sql<number>`row_number() over (partition by ${agentRun.agentId} order by ${agentRun.createdAt}, ${agentRun.id})`.as(
          "agent_turn",
        ),
    })
    .from(agentRun)
    .innerJoin(
      agentDefinition,
      and(
        eq(agentDefinition.id, agentRun.agentId),
        eq(agentDefinition.status, "LIVE"),
      ),
    )
    .where(
      and(
        eq(agentRun.status, "QUEUED"),
        input.organizationId
          ? eq(agentRun.organizationId, input.organizationId)
          : undefined,
        notExists(
          db
            .select({ id: otherRun.id })
            .from(otherRun)
            .where(
              and(
                eq(otherRun.agentId, agentRun.agentId),
                eq(otherRun.status, "RUNNING"),
              ),
            ),
        ),
      ),
    )
    .as("startable");
  const next = db
    .select({
      id: startable.id,
      organizationId: startable.organizationId,
      agentId: startable.agentId,
      versionId: startable.versionId,
      createdAt: startable.createdAt,
      turn: sql<number>`row_number() over (partition by ${startable.organizationId} order by ${startable.createdAt}, ${startable.id})`.as(
        "turn",
      ),
    })
    .from(startable)
    .where(eq(startable.agentTurn, 1))
    .as("next");
  return db
    .select({
      id: next.id,
      organizationId: next.organizationId,
      agentId: next.agentId,
      versionId: next.versionId,
    })
    .from(next)
    .where(lte(next.turn, input.perOrganization))
    .orderBy(asc(next.turn), asc(next.createdAt), asc(next.id))
    .limit(input.limit);
}

/**
 * Running runs that started before `before`: delivered ones that never
 * finished (`delivered`), or ones whose delivery never landed.
 */
async function runningSince(before: string, delivered: boolean, limit: number) {
  return db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      sessionId: agentRun.sessionId,
    })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.status, "RUNNING"),
        lt(agentRun.startedAt, before),
        delivered
          ? sql`${agentRun.sessionId} is not null`
          : isNull(agentRun.sessionId),
      ),
    )
    .orderBy(asc(agentRun.startedAt))
    .limit(limit);
}

/** Queued runs of an agent that is no longer live, to cancel. */
async function queuedOfStoppedAgents(limit: number) {
  return db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      versionId: agentRun.versionId,
      agentStatus: agentDefinition.status,
    })
    .from(agentRun)
    .innerJoin(agentDefinition, eq(agentDefinition.id, agentRun.agentId))
    .where(
      and(
        eq(agentRun.status, "QUEUED"),
        or(
          eq(agentDefinition.status, "DELETED"),
          eq(agentDefinition.status, "ARCHIVED"),
        ),
      ),
    )
    .limit(limit);
}

export const RunQueueRepository = {
  queuedAcrossOrganizations,
  runningSince,
  queuedOfStoppedAgents,
};
