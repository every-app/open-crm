import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  max,
  sql,
} from "drizzle-orm";
import { sort } from "remeda";
import { db } from "@/db";
import {
  contact,
  formSubmission,
  trackedEvent,
  trackedVisitor,
} from "@/db/schema";

// What website tracking shows back: a record's website activity, traffic
// sources, the settings' totals and verify's "page view just now". Every
// function takes the organization and filters by it.

/** Whether a page on `host` sent anything since `since`. */
async function seenOnHostSince(
  organizationId: string,
  host: string,
  since: string,
) {
  const [row] = await db
    .select({ id: trackedEvent.id })
    .from(trackedEvent)
    .where(
      and(
        eq(trackedEvent.organizationId, organizationId),
        eq(trackedEvent.host, host),
        gte(trackedEvent.occurredAt, since),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Page views, form submissions and the latest event, for settings. */
async function totals(organizationId: string) {
  const [[views], [submissions], [latest]] = await Promise.all([
    db
      .select({ value: count() })
      .from(trackedEvent)
      .where(
        and(
          eq(trackedEvent.organizationId, organizationId),
          eq(trackedEvent.type, "page_view"),
        ),
      ),
    db
      .select({ value: count() })
      .from(formSubmission)
      .where(eq(formSubmission.organizationId, organizationId)),
    db
      .select({ at: max(trackedEvent.occurredAt) })
      .from(trackedEvent)
      .where(eq(trackedEvent.organizationId, organizationId)),
  ]);
  return {
    pageViews: views?.value ?? 0,
    submissions: submissions?.value ?? 0,
    receivingSince: latest?.at ?? null,
  };
}

/** The visitors identified as a contact, or as anyone at a company. */
async function visitorIdsFor(
  organizationId: string,
  record: { contactId: string } | { companyId: string },
) {
  const query = db
    .select({ id: trackedVisitor.id })
    .from(trackedVisitor)
    .innerJoin(
      contact,
      and(
        eq(contact.id, trackedVisitor.contactId),
        eq(contact.organizationId, organizationId),
      ),
    );
  const rows = await query.where(
    and(
      eq(trackedVisitor.organizationId, organizationId),
      "contactId" in record
        ? eq(contact.id, record.contactId)
        : eq(contact.companyId, record.companyId),
    ),
  );
  return rows.map((row) => row.id);
}

const MAX_VISITORS = 50;
const TOP_PAGES = 10;

/** What the visitors did: their touches, top pages, views and last visit. */
async function activityOf(organizationId: string, visitorIds: string[]) {
  // A company's people rarely number more than a handful of browsers; the
  // cap keeps the IN lists inside D1's bound parameters.
  const ids = visitorIds.slice(0, MAX_VISITORS);
  const visitors = and(
    eq(trackedVisitor.organizationId, organizationId),
    inArray(trackedVisitor.id, ids),
  );
  const events = and(
    eq(trackedEvent.organizationId, organizationId),
    inArray(trackedEvent.visitorId, ids),
  );
  const pageViews = and(events, eq(trackedEvent.type, "page_view"));
  const [[first], [last], pages, [summary]] = await Promise.all([
    db
      .select()
      .from(trackedVisitor)
      .where(and(visitors, isNotNull(trackedVisitor.firstSource)))
      .orderBy(trackedVisitor.firstTouchAt)
      .limit(1),
    db
      .select()
      .from(trackedVisitor)
      .where(and(visitors, isNotNull(trackedVisitor.lastSource)))
      .orderBy(desc(trackedVisitor.lastTouchAt))
      .limit(1),
    db
      .select({
        host: trackedEvent.host,
        path: trackedEvent.path,
        views: count(),
        lastSeenAt: max(trackedEvent.occurredAt),
      })
      .from(trackedEvent)
      .where(pageViews)
      .groupBy(trackedEvent.host, trackedEvent.path)
      .orderBy(desc(count()), trackedEvent.path)
      .limit(TOP_PAGES),
    db
      .select({
        views: sql<number>`sum(case when ${trackedEvent.type} = 'page_view' then 1 else 0 end)`,
        lastSeenAt: max(trackedEvent.occurredAt),
      })
      .from(trackedEvent)
      .where(events),
  ]);
  return {
    first: first ?? null,
    last: last ?? null,
    pages,
    views: Number(summary?.views ?? 0),
    lastSeenAt: summary?.lastSeenAt ?? null,
  };
}

/**
 * The newest form submissions filed under a contact, or under anyone at a
 * company, with whom each was filed under.
 */
async function submissionsFor(
  organizationId: string,
  record: { contactId: string } | { companyId: string },
  limit: number,
) {
  return db
    .select({
      host: formSubmission.host,
      path: formSubmission.path,
      submittedAt: formSubmission.createdAt,
      contactId: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(formSubmission)
    .innerJoin(
      contact,
      and(
        eq(contact.id, formSubmission.contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(formSubmission.organizationId, organizationId),
        "contactId" in record
          ? eq(contact.id, record.contactId)
          : eq(contact.companyId, record.companyId),
      ),
    )
    .orderBy(desc(formSubmission.createdAt), desc(formSubmission.id))
    .limit(limit);
}

const TOP_SOURCES = 20;

/** Page views per source, and the contacts each first brought in. */
async function sources(organizationId: string) {
  const [views, contacts] = await Promise.all([
    db
      .select({
        source: trackedEvent.source,
        medium: trackedEvent.medium,
        views: count(),
      })
      .from(trackedEvent)
      .where(
        and(
          eq(trackedEvent.organizationId, organizationId),
          eq(trackedEvent.type, "page_view"),
          isNotNull(trackedEvent.source),
        ),
      )
      .groupBy(trackedEvent.source, trackedEvent.medium),
    db
      .select({
        source: trackedVisitor.firstSource,
        medium: trackedVisitor.firstMedium,
        contacts: countDistinct(trackedVisitor.contactId),
      })
      .from(trackedVisitor)
      .where(
        and(
          eq(trackedVisitor.organizationId, organizationId),
          isNotNull(trackedVisitor.contactId),
          isNotNull(trackedVisitor.firstSource),
        ),
      )
      .groupBy(trackedVisitor.firstSource, trackedVisitor.firstMedium),
  ]);
  const rows = new Map<
    string,
    { source: string; medium: string | null; views: number; contacts: number }
  >();
  for (const row of views) {
    if (!row.source) continue;
    rows.set(`${row.source}|${row.medium ?? ""}`, {
      source: row.source,
      medium: row.medium,
      views: row.views,
      contacts: 0,
    });
  }
  for (const row of contacts) {
    if (!row.source) continue;
    const key = `${row.source}|${row.medium ?? ""}`;
    const existing = rows.get(key);
    if (existing) existing.contacts = row.contacts;
    else
      rows.set(key, {
        source: row.source,
        medium: row.medium,
        views: 0,
        contacts: row.contacts,
      });
  }
  return sort(
    [...rows.values()],
    (a, b) => b.contacts - a.contacts || b.views - a.views,
  ).slice(0, TOP_SOURCES);
}

export const WebsiteActivityRepository = {
  seenOnHostSince,
  totals,
  visitorIdsFor,
  activityOf,
  submissionsFor,
  sources,
};
