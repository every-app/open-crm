import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentAuditEvent, agentVersion, user } from "@/db/schema";

// Every change to a team agent and every run request (agent_audit_event),
// for its Activity tab. A request replayed with the same id is recorded once.

export type NewAudit = {
  organizationId: string;
  agentId: string;
  versionId?: string | null;
  actorUserId?: string | null;
  actorType: "USER" | "AGENT" | "SYSTEM";
  type: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

export function auditValues(event: NewAudit) {
  return {
    id: crypto.randomUUID(),
    organizationId: event.organizationId,
    agentId: event.agentId,
    versionId: event.versionId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorType: event.actorType,
    type: event.type,
    summary: event.summary,
    before: event.before ?? null,
    after: event.after ?? null,
    requestId: event.requestId ?? null,
    emittedAt: new Date().toISOString(),
  };
}

async function findAudit(
  organizationId: string,
  agentId: string,
  type: string,
  requestId: string,
) {
  const [row] = await db
    .select({ id: agentAuditEvent.id, versionId: agentAuditEvent.versionId })
    .from(agentAuditEvent)
    .where(
      and(
        eq(agentAuditEvent.organizationId, organizationId),
        eq(agentAuditEvent.agentId, agentId),
        eq(agentAuditEvent.type, type),
        eq(agentAuditEvent.requestId, requestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Records an audit line; one with the same request id is recorded once. */
async function audit(event: NewAudit): Promise<void> {
  const insert = db.insert(agentAuditEvent).values(auditValues(event));
  await (event.requestId
    ? insert.onConflictDoNothing({
        target: [
          agentAuditEvent.agentId,
          agentAuditEvent.type,
          agentAuditEvent.requestId,
        ],
      })
    : insert);
}

/** The agent's activity: every change and run request, newest first. */
async function listAudit(
  organizationId: string,
  agentId: string,
  limit: number,
) {
  return db
    .select({
      id: agentAuditEvent.id,
      type: agentAuditEvent.type,
      summary: agentAuditEvent.summary,
      before: agentAuditEvent.before,
      after: agentAuditEvent.after,
      requestId: agentAuditEvent.requestId,
      actorType: agentAuditEvent.actorType,
      actorName: user.name,
      versionNumber: agentVersion.number,
      emittedAt: agentAuditEvent.emittedAt,
    })
    .from(agentAuditEvent)
    .leftJoin(user, eq(user.id, agentAuditEvent.actorUserId))
    .leftJoin(agentVersion, eq(agentVersion.id, agentAuditEvent.versionId))
    .where(
      and(
        eq(agentAuditEvent.organizationId, organizationId),
        eq(agentAuditEvent.agentId, agentId),
      ),
    )
    .orderBy(desc(agentAuditEvent.emittedAt), desc(agentAuditEvent.id))
    .limit(limit);
}

export const AuditRepository = {
  findAudit,
  audit,
  listAudit,
};
