import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  calendarAttendee,
  calendarEvent,
  company,
  contact,
  deal,
  dealContact,
  emailMessage,
  emailThread,
} from "@/db/schema";
import { OPEN_STAGES } from "@/server/features/companies/repositories/CompanyRelationsRepository";
import { idChunks } from "@/server/features/records/recordRules";

// A contact and the records around them: the company they work at (and
// moving them to another), the deals they are on, the colleagues filed at
// the same company, and the mail and meetings captured with them. The
// companies and deals features own those records; contacts only read them,
// compactly, and link to them.

/** Whether `companyId` is one of the organization's live companies. */
async function isLiveCompany(organizationId: string, companyId: string) {
  const [row] = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
        isNull(company.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The statement that clears the primary claims `contactIds` hold on any
 * company but `keep`, for the batch that moves them: a company never names
 * someone who works elsewhere.
 */
export function leaveOtherCompanies(
  tx: typeof db,
  organizationId: string,
  contactIds: string[],
  keep: string | null,
) {
  return tx
    .update(company)
    .set({ primaryContactId: null, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(company.organizationId, organizationId),
        inArray(company.primaryContactId, contactIds),
        keep ? ne(company.id, keep) : undefined,
      ),
    );
}

/**
 * Moves `ids` to `companyId` (or no company), each part in one batch with
 * the primary claims they leave behind; how many it moved.
 */
async function setCompany(
  organizationId: string,
  ids: string[],
  companyId: string | null,
) {
  let moved = 0;
  for (const part of idChunks(ids)) {
    const found = await db
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, part),
        ),
      );
    const theirs = found.map((row) => row.id);
    if (theirs.length === 0) continue;
    await runBatch((tx) => [
      tx
        .update(contact)
        .set({ companyId, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(contact.organizationId, organizationId),
            inArray(contact.id, theirs),
          ),
        ),
      leaveOtherCompanies(tx, organizationId, theirs, companyId),
    ]);
    moved += theirs.length;
  }
  return moved;
}

/** The live deals the contact is on, open ones first, soonest close first. */
async function listDeals(organizationId: string, contactId: string) {
  const open = inArray(deal.stage, OPEN_STAGES);
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
      role: dealContact.role,
    })
    .from(dealContact)
    .innerJoin(
      deal,
      and(
        eq(deal.id, dealContact.dealId),
        eq(deal.organizationId, dealContact.organizationId),
      ),
    )
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        eq(dealContact.contactId, contactId),
        isNull(deal.archivedAt),
      ),
    )
    .orderBy(
      sql`case when ${open} then 0 else 1 end`,
      sql`(${deal.expectedCloseDate} is null)`,
      asc(deal.expectedCloseDate),
      asc(deal.id),
    );
  return rows.map((row) => ({
    ...row,
    open: OPEN_STAGES.includes(row.stage),
  }));
}

/** Up to four other live people at the company, most recently active first. */
async function listColleagues(
  organizationId: string,
  contactId: string,
  companyId: string,
) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.companyId, companyId),
        ne(contact.id, contactId),
        isNull(contact.archivedAt),
      ),
    )
    .orderBy(
      sql`(${contact.lastActivityAt} is null)`,
      desc(contact.lastActivityAt),
      asc(contact.id),
    )
    .limit(4);
}

/**
 * The mail and meetings captured with the contact: how many emails in how
 * many threads, when they last replied, how many meetings they were on
 * (as the event's contact or an attendee), and the next one.
 */
async function relationship(organizationId: string, contactId: string) {
  const theirMeetings = and(
    eq(calendarEvent.organizationId, organizationId),
    or(
      eq(calendarEvent.contactId, contactId),
      exists(
        db
          .select({ id: calendarAttendee.id })
          .from(calendarAttendee)
          .where(
            and(
              eq(calendarAttendee.eventId, calendarEvent.id),
              eq(calendarAttendee.contactId, contactId),
            ),
          ),
      ),
    ),
  );
  const [[threads], [lastReply], [meetings], [nextMeeting]] = await Promise.all(
    [
      db
        .select({
          emails:
            sql<number>`coalesce(sum(${emailThread.messageCount}), 0)`.mapWith(
              Number,
            ),
          threads: count(),
        })
        .from(emailThread)
        .where(
          and(
            eq(emailThread.organizationId, organizationId),
            eq(emailThread.contactId, contactId),
          ),
        ),
      db
        .select({ at: max(emailMessage.sentAt) })
        .from(emailMessage)
        .innerJoin(emailThread, eq(emailThread.id, emailMessage.threadId))
        .where(
          and(
            eq(emailMessage.organizationId, organizationId),
            eq(emailThread.contactId, contactId),
            eq(emailMessage.direction, "INBOUND"),
          ),
        ),
      db.select({ value: count() }).from(calendarEvent).where(theirMeetings),
      db
        .select({
          title: calendarEvent.title,
          startsAt: calendarEvent.startsAt,
        })
        .from(calendarEvent)
        .where(
          and(
            theirMeetings,
            gt(calendarEvent.startsAt, new Date().toISOString()),
          ),
        )
        .orderBy(asc(calendarEvent.startsAt))
        .limit(1),
    ],
  );
  return {
    emails: threads?.emails ?? 0,
    threads: threads?.threads ?? 0,
    lastReplyAt: lastReply?.at ?? null,
    meetings: meetings?.value ?? 0,
    nextMeeting: nextMeeting ?? null,
  };
}

export const ContactRelationsRepository = {
  isLiveCompany,
  setCompany,
  listDeals,
  listColleagues,
  relationship,
};
