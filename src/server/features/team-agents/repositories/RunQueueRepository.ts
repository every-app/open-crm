import { and, asc, eq, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { agentDefinition, agentRun } from "@/db/schema";

// The team-agent dispatcher's scans (runtime/dispatch.ts): queued runs to
// start, runs that overran or never got going, queued runs of agents that
// stopped. The one place run reads span organizations: each returns the
// organization of every run it hands back.

/**
 * Queued runs of live agents with nothing running, oldest first: the next
 * runs to start, at most one per agent.
 */
async function queuedAcrossOrganizations(
  limit: number,
  organizationId?: string,
) {
  const otherRun = alias(agentRun, "other_run");
  const rows = await db
    .select({
      id: agentRun.id,
      organizationId: agentRun.organizationId,
      agentId: agentRun.agentId,
      versionId: agentRun.versionId,
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
        organizationId
          ? eq(agentRun.organizationId, organizationId)
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
    .orderBy(asc(agentRun.createdAt), asc(agentRun.id))
    .limit(limit * 4);
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.agentId)) return false;
      seen.add(row.agentId);
      return true;
    })
    .slice(0, limit);
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
