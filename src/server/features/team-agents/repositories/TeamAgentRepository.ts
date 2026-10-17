import { and, count, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { agentDefinition, agentRun, agentVersion, user } from "@/db/schema";
import {
  TEAM_VISIBLE_STATUSES,
  type TeamAgentStatus,
} from "@/shared/team-agents";

// Team agents, their versions, triggers, files and audit (team-agent.schema).
// Every read and write is scoped to the organization; an agent id from a
// client is never trusted on its own.

const ID_CHUNK = 90;

const agentColumns = () => ({
  id: agentDefinition.id,
  name: agentDefinition.name,
  description: agentDefinition.description,
  status: agentDefinition.status,
  createdById: agentDefinition.createdById,
  createdByName: user.name,
  conversationId: agentDefinition.conversationId,
  currentVersionId: agentDefinition.currentVersionId,
  createdAt: agentDefinition.createdAt,
  updatedAt: agentDefinition.updatedAt,
  archivedAt: agentDefinition.archivedAt,
});

/**
 * The agents a person sees: the team's (live, paused, archived) and their own
 * drafts, most recently changed first.
 */
async function listVisible(organizationId: string, userId: string) {
  return db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        or(
          inArray(agentDefinition.status, [...TEAM_VISIBLE_STATUSES]),
          and(
            eq(agentDefinition.status, "DRAFT"),
            eq(agentDefinition.createdById, userId),
          ),
        ),
      ),
    )
    .orderBy(desc(agentDefinition.updatedAt), desc(agentDefinition.id))
    .limit(200);
}

/** One agent of the organization, unless it was deleted. */
async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        ne(agentDefinition.status, "DELETED"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The agent a builder chat made, if it has saved one. */
async function findByConversation(
  organizationId: string,
  conversationId: string,
) {
  const [row] = await db
    .select(agentColumns())
    .from(agentDefinition)
    .innerJoin(user, eq(user.id, agentDefinition.createdById))
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.conversationId, conversationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Run counts per agent. */
async function runCounts(
  organizationId: string,
  agentIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const ids of chunk(agentIds, ID_CHUNK)) {
    const rows = await db
      .select({ agentId: agentRun.agentId, runs: count() })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.organizationId, organizationId),
          inArray(agentRun.agentId, ids),
        ),
      )
      .groupBy(agentRun.agentId);
    for (const row of rows) counts.set(row.agentId, row.runs);
  }
  return counts;
}

export type NewAgent = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdById: string;
  conversationId: string | null;
};

/**
 * Moves the agent from one of `from` to `status`, with `patch`. The row as it
 * now is, or null when it wasn't in one of those statuses.
 */
async function transition(
  organizationId: string,
  id: string,
  from: readonly TeamAgentStatus[],
  status: TeamAgentStatus,
  patch: Partial<{
    archivedAt: string | null;
    deletedAt: string | null;
  }> = {},
) {
  const [row] = await db
    .update(agentDefinition)
    .set({ status, ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        inArray(agentDefinition.status, [...from]),
      ),
    )
    .returning({
      id: agentDefinition.id,
      name: agentDefinition.name,
      status: agentDefinition.status,
    });
  return row ?? null;
}

async function updateDetails(
  organizationId: string,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<boolean> {
  const rows = await db
    .update(agentDefinition)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        eq(agentDefinition.id, id),
        ne(agentDefinition.status, "DELETED"),
      ),
    )
    .returning({ id: agentDefinition.id });
  return rows.length > 0;
}

/** Live and paused agents whose deployed version posts to Slack. */
async function slackAgents(organizationId: string) {
  return db
    .select({
      id: agentDefinition.id,
      name: agentDefinition.name,
      description: agentDefinition.description,
      status: agentDefinition.status,
      manifest: agentVersion.manifest,
    })
    .from(agentDefinition)
    .innerJoin(
      agentVersion,
      eq(agentVersion.id, agentDefinition.currentVersionId),
    )
    .where(
      and(
        eq(agentDefinition.organizationId, organizationId),
        inArray(agentDefinition.status, ["LIVE", "PAUSED"]),
        isNotNull(agentDefinition.currentVersionId),
      ),
    )
    .orderBy(desc(agentDefinition.updatedAt))
    .limit(100);
}

export const TeamAgentRepository = {
  listVisible,
  findById,
  findByConversation,
  runCounts,
  transition,
  updateDetails,
  slackAgents,
};
