import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  formSubmission,
  suppressedContact,
  suppressedDomain,
  trackedEvent,
  trackedVisitor,
  trackingCounter,
} from "@/db/schema";

// What the collector writes (events, counters, form submissions, the
// visitors a submission identifies), and what record sheets and settings
// read back. Every function takes the organization and filters by it.

/**
 * Charges `amount` to a counter if that keeps it within `limit`, in one
 * statement: the check and the charge cannot be separated, and a refused
 * charge spends nothing (increment-then-compare would let one oversized
 * batch lock out the honest small ones behind it).
 */
async function take(
  organizationId: string,
  key: string,
  limit: number,
  amount: number,
  expiresAt: string,
): Promise<boolean> {
  if (amount <= 0) return true;
  if (amount > limit) return false;
  const charged = await db
    .insert(trackingCounter)
    .values({ organizationId, key, value: amount, expiresAt })
    .onConflictDoUpdate({
      target: [trackingCounter.organizationId, trackingCounter.key],
      set: { value: sql`${trackingCounter.value} + ${amount}` },
      setWhere: sql`${trackingCounter.value} + ${amount} <= ${limit}`,
    })
    .returning({ value: trackingCounter.value });
  return charged.length > 0;
}

/** Hands back a charge whose work did not happen. */
async function release(organizationId: string, key: string, amount: number) {
  await db
    .update(trackingCounter)
    .set({
      value: sql`case when ${trackingCounter.value} > ${amount} then ${trackingCounter.value} - ${amount} else 0 end`,
    })
    .where(
      and(
        eq(trackingCounter.organizationId, organizationId),
        eq(trackingCounter.key, key),
      ),
    );
}

type NewEvent = Omit<typeof trackedEvent.$inferInsert, "id">;

/** One statement per event, so a batch stays under D1's bound parameters. */
async function insertEvents(events: NewEvent[]) {
  await executeInBatches(events, (tx, event) =>
    tx.insert(trackedEvent).values({ ...event, id: crypto.randomUUID() }),
  );
}

type NewSubmission = Omit<
  typeof formSubmission.$inferInsert,
  "id" | "filedAt" | "skipReason" | "contactId" | "createdAt"
>;

/**
 * Stores a submission once per dedupe key. The stored row, and whether
 * this call created it.
 */
async function insertSubmission(values: NewSubmission) {
  const id = crypto.randomUUID();
  await db
    .insert(formSubmission)
    .values({ ...values, id })
    .onConflictDoNothing({
      target: [formSubmission.organizationId, formSubmission.dedupeKey],
    });
  const [row] = await db
    .select({
      id: formSubmission.id,
      filedAt: formSubmission.filedAt,
      skipReason: formSubmission.skipReason,
    })
    .from(formSubmission)
    .where(
      and(
        eq(formSubmission.organizationId, values.organizationId),
        eq(formSubmission.dedupeKey, values.dedupeKey),
      ),
    )
    .limit(1);
  return row ? { ...row, created: row.id === id } : null;
}

/**
 * Files an unfiled submission under a contact. False when another delivery
 * of it got there first; that caller writes nothing more.
 */
async function claimSubmission(
  organizationId: string,
  id: string,
  contactId: string,
) {
  const claimed = await db
    .update(formSubmission)
    .set({
      contactId,
      filedAt: new Date().toISOString(),
      skipReason: null,
    })
    .where(
      and(
        eq(formSubmission.organizationId, organizationId),
        eq(formSubmission.id, id),
        isNull(formSubmission.filedAt),
      ),
    )
    .returning({ id: formSubmission.id });
  return claimed.length > 0;
}

async function skipSubmission(
  organizationId: string,
  id: string,
  reason: string,
) {
  await db
    .update(formSubmission)
    .set({ skipReason: reason })
    .where(
      and(
        eq(formSubmission.organizationId, organizationId),
        eq(formSubmission.id, id),
      ),
    );
}

export type TouchColumns = {
  source: string;
  medium: string;
  campaign: string | null;
  term: string | null;
  content: string | null;
  referrer: string | null;
  landing: string | null;
  at: string;
};

function firstColumns(touch: TouchColumns) {
  return {
    firstSource: touch.source,
    firstMedium: touch.medium,
    firstCampaign: touch.campaign,
    firstTerm: touch.term,
    firstContent: touch.content,
    firstReferrer: touch.referrer,
    firstLanding: touch.landing,
    firstTouchAt: touch.at,
  };
}

function lastColumns(touch: TouchColumns) {
  return {
    lastSource: touch.source,
    lastMedium: touch.medium,
    lastCampaign: touch.campaign,
    lastTerm: touch.term,
    lastContent: touch.content,
    lastReferrer: touch.referrer,
    lastLanding: touch.landing,
    lastTouchAt: touch.at,
  };
}

/**
 * Ties a visitor to the contact their submission filed under. Their first
 * touch is written once; the last moves with every submission.
 */
async function identifyVisitor(
  organizationId: string,
  visitorId: string,
  contactId: string,
  touches: { first: TouchColumns; last: TouchColumns },
) {
  const now = new Date().toISOString();
  await db
    .insert(trackedVisitor)
    .values({
      organizationId,
      id: visitorId,
      contactId,
      ...firstColumns(touches.first),
      ...lastColumns(touches.last),
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      target: [trackedVisitor.organizationId, trackedVisitor.id],
      set: { contactId, ...lastColumns(touches.last), lastSeen: now },
    });
}

/**
 * Whether a person deleted the contact with this address, or the domain is
 * one the organization keeps out: a form never brings either back.
 */
async function suppression(
  organizationId: string,
  email: string,
  domain: string,
) {
  const [[address], [host]] = await Promise.all([
    db
      .select({ email: suppressedContact.email })
      .from(suppressedContact)
      .where(
        and(
          eq(suppressedContact.organizationId, organizationId),
          eq(suppressedContact.email, email),
        ),
      )
      .limit(1),
    db
      .select({ domain: suppressedDomain.domain })
      .from(suppressedDomain)
      .where(
        and(
          eq(suppressedDomain.organizationId, organizationId),
          eq(suppressedDomain.domain, domain),
        ),
      )
      .limit(1),
  ]);
  return { address: address !== undefined, domain: host !== undefined };
}

export const TrackingEventRepository = {
  take,
  release,
  insertEvents,
  insertSubmission,
  claimSubmission,
  skipSubmission,
  identifyVisitor,
  suppression,
};
