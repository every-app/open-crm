import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agentDefinition,
  company,
  mailboxConnection,
  member,
  trackedEvent,
} from "@/db/schema";

/**
 * What the workspace (and the person) has done of Get started's steps: one
 * small read each, the existence of a row rather than a count of them.
 */
async function progress(organizationId: string, userId: string) {
  const [companies, mailboxes, agents, events, [members]] = await Promise.all([
    db
      .select({ id: company.id })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          isNull(company.archivedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: mailboxConnection.id })
      .from(mailboxConnection)
      .where(
        and(
          eq(mailboxConnection.organizationId, organizationId),
          eq(mailboxConnection.userId, userId),
        ),
      )
      .limit(1),
    db
      .select({ id: agentDefinition.id })
      .from(agentDefinition)
      .where(
        and(
          eq(agentDefinition.organizationId, organizationId),
          inArray(agentDefinition.status, ["LIVE", "PAUSED"]),
        ),
      )
      .limit(1),
    db
      .select({ id: trackedEvent.id })
      .from(trackedEvent)
      .where(eq(trackedEvent.organizationId, organizationId))
      .limit(1),
    db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  ]);
  return {
    companies: companies.length > 0,
    inbox: mailboxes.length > 0,
    agent: agents.length > 0,
    tracking: events.length > 0,
    // Someone else has opened the CRM.
    team: (members?.value ?? 0) > 1,
  };
}

export const SetupRepository = { progress };
