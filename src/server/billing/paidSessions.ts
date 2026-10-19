import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { paidSession } from "@/db/schema";

// How many paid agent sessions an organization runs at once, where usage is
// billed: PAID_SESSIONS_PER_KIND chat turns, research sessions and team
// agent runs. The rest wait: the dispatcher leaves queued work in the queue,
// and a chat turn waits for a slot (meter.ts). Work admitted on one balance
// reading spends before it is billed, so this bounds how far it can overdraw.
//
// A session holds a numbered slot (paid_session) from its start until it
// ends, or until its lease runs out if it never says so. A claim inserts a
// free slot number, or takes over a lapsed one, with a conditional upsert:
// the number is in the key, so two claimers never both get one, on either
// backend.

const PAID_SESSIONS_PER_KIND = 3;

export type PaidSessionClaim = {
  organizationId: string;
  kind: "chat" | "research" | "run";
  /** The CrmAgent's name (sessionName.ts). */
  sessionId: string;
  leaseMs: number;
};

/**
 * Takes one of the organization's slots of `kind` for the session, or renews
 * the one it holds. False while every one is held.
 */
async function claim(input: PaidSessionClaim): Promise<boolean> {
  const { organizationId, kind, sessionId } = input;
  const now = new Date().toISOString();
  const leasedUntil = new Date(Date.now() + input.leaseMs).toISOString();
  const ofKind = and(
    eq(paidSession.organizationId, organizationId),
    eq(paidSession.kind, kind),
  );
  const held = await db
    .select({ slot: paidSession.slot, sessionId: paidSession.sessionId })
    .from(paidSession)
    .where(and(ofKind, gte(paidSession.leasedUntil, now)));
  if (held.some((row) => row.sessionId === sessionId)) {
    const renewed = await db
      .update(paidSession)
      .set({ leasedUntil })
      .where(and(ofKind, eq(paidSession.sessionId, sessionId)))
      .returning({ slot: paidSession.slot });
    if (renewed.length > 0) return true;
  }
  for (let slot = 0; slot < PAID_SESSIONS_PER_KIND; slot += 1) {
    if (held.some((row) => row.slot === slot)) continue;
    const [taken] = await db
      .insert(paidSession)
      .values({ organizationId, kind, slot, sessionId, leasedUntil })
      .onConflictDoUpdate({
        target: [
          paidSession.organizationId,
          paidSession.kind,
          paidSession.slot,
        ],
        set: { sessionId, leasedUntil },
        setWhere: lt(paidSession.leasedUntil, now),
      })
      .returning({ slot: paidSession.slot });
    if (taken) return true;
  }
  return false;
}

/** The session ended: its slot frees for the organization's next one. */
async function release(
  organizationId: string,
  sessionId: string,
): Promise<void> {
  await db
    .delete(paidSession)
    .where(
      and(
        eq(paidSession.organizationId, organizationId),
        eq(paidSession.sessionId, sessionId),
      ),
    );
}

export const PaidSessionRepository = { claim, release };
