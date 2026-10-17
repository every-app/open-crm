import { and, asc, eq, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { agentAction, agentAuditEvent, agentEvent } from "@/db/schema";
import type { NewAudit } from "./AuditRepository";

// What a run's history drawer shows beside its row: its events, filed as
// agent_event rows under the run's session (`run.<organization>.<run id>`) as
// every CrmAgent session's steps are, from "queued" to how it ended.

const ID_CHUNK = 90;

/** The steps of these runs' sessions, in order, at most `limit` each. */
async function eventsForSessions(organizationId: string, sessionIds: string[]) {
  const rows = [];
  for (const ids of chunk(sessionIds, ID_CHUNK)) {
    rows.push(
      ...(await db
        .select({
          id: agentEvent.id,
          sessionId: agentEvent.sessionId,
          type: agentEvent.type,
          data: agentEvent.data,
          emittedAt: agentEvent.emittedAt,
        })
        .from(agentEvent)
        .where(
          and(
            eq(agentEvent.organizationId, organizationId),
            inArray(agentEvent.sessionId, ids),
          ),
        )
        .orderBy(asc(agentEvent.emittedAt), asc(agentEvent.id))),
    );
  }
  return rows;
}

/** A run event outside the session's own steps (queued, started). */
async function insertEvent(input: {
  organizationId: string;
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await db.insert(agentEvent).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    contactId: null,
    companyId: null,
    dealId: null,
    conversationId: null,
    type: input.type,
    data: input.data,
    emittedAt: new Date().toISOString(),
  });
}

/**
 * What the winner of a settle writes after it: the run's terminal event, its
 * outstanding actions cancelled (when it was stopped) and the audit line, in
 * one batch. Each is idempotent, so writing them twice changes nothing.
 */
async function recordEnding(input: {
  organizationId: string;
  runId: string;
  sessionId: string;
  type: "run.completed" | "run.failed" | "run.cancelled";
  data: Record<string, unknown>;
  cancelActions: { code: string; message: string } | null;
  audit: NewAudit;
}): Promise<void> {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    ...(input.cancelActions
      ? [
          tx
            .update(agentAction)
            .set({
              status: "CANCELLED",
              errorCode: input.cancelActions.code,
              errorMessage: input.cancelActions.message,
              completedAt: now,
            })
            .where(
              and(
                eq(agentAction.organizationId, input.organizationId),
                eq(agentAction.runId, input.runId),
                inArray(agentAction.status, ["PLANNED", "RUNNING"]),
              ),
            ),
        ]
      : []),
    tx
      .insert(agentEvent)
      .values({
        id: `${input.type}:${input.runId}`,
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        contactId: null,
        companyId: null,
        dealId: null,
        conversationId: null,
        type: input.type,
        data: input.data,
        emittedAt: now,
      })
      .onConflictDoNothing({ target: agentEvent.id }),
    tx
      .insert(agentAuditEvent)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        agentId: input.audit.agentId,
        versionId: input.audit.versionId ?? null,
        actorUserId: input.audit.actorUserId ?? null,
        actorType: input.audit.actorType,
        type: input.audit.type,
        summary: input.audit.summary,
        requestId: input.audit.requestId ?? null,
        emittedAt: now,
      })
      .onConflictDoNothing({
        target: [
          agentAuditEvent.agentId,
          agentAuditEvent.type,
          agentAuditEvent.requestId,
        ],
      }),
  ]);
}

export const RunEventRepository = {
  eventsForSessions,
  insertEvent,
  recordEnding,
};
