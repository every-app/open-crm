import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  calendarAttendee,
  calendarEvent,
  company,
  contact,
  deal,
  dealContact,
  emailMessage,
  emailThread,
} from "@/db/schema";
import { descNullsLast } from "./order";

// What the CRM already holds about a record, for the agent's free history
// reads (read_crm_history, read_company_history, read_deal_history). Ported
// from the CRM's lib/crm.ts and lib/accounts.ts. Every query is scoped to the
// organization; bodies are capped so one long thread cannot crowd out the rest.

const BODY_LIMIT = 4000;
const NOTE_TYPES = ["NOTE", "CALL", "TASK", "ENRICHMENT"] as const;

type HistoryThread = {
  subject: string | null;
  contact: { id: string; name: string } | null;
  messageCount: number;
  lastMessageAt: string;
  messages: {
    direction: string;
    from: string;
    fromName: string | null;
    sentAt: string;
    body: string | null;
  }[];
};

type HistoryMeeting = {
  title: string | null;
  startsAt: string;
  upcoming: boolean;
  attendees: {
    email: string;
    name: string | null;
    contactId: string | null;
    responseStatus: string | null;
  }[];
};

const name = (person: { firstName: string; lastName: string | null }) =>
  [person.firstName, person.lastName].filter(Boolean).join(" ");

/** Threads matching `where`, newest first, each with its latest messages. */
async function threadsWhere(
  organizationId: string,
  where: SQL | undefined,
  limit: number,
  perThread: number,
): Promise<HistoryThread[]> {
  const threads = await db
    .select({
      id: emailThread.id,
      subject: emailThread.subject,
      messageCount: emailThread.messageCount,
      lastMessageAt: emailThread.lastMessageAt,
      contactId: contact.id,
      contactFirstName: contact.firstName,
      contactLastName: contact.lastName,
    })
    .from(emailThread)
    .leftJoin(
      contact,
      and(
        eq(contact.id, emailThread.contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .where(and(eq(emailThread.organizationId, organizationId), where))
    .orderBy(desc(emailThread.lastMessageAt))
    .limit(limit);
  return Promise.all(
    threads.map(async (thread) => {
      const messages = await db
        .select({
          direction: emailMessage.direction,
          from: emailMessage.fromEmail,
          fromName: emailMessage.fromName,
          sentAt: emailMessage.sentAt,
          body: emailMessage.body,
          snippet: emailMessage.snippet,
        })
        .from(emailMessage)
        .where(
          and(
            eq(emailMessage.organizationId, organizationId),
            eq(emailMessage.threadId, thread.id),
          ),
        )
        .orderBy(desc(emailMessage.sentAt))
        .limit(perThread);
      return {
        subject: thread.subject,
        contact:
          thread.contactId && thread.contactFirstName
            ? {
                id: thread.contactId,
                name: name({
                  firstName: thread.contactFirstName,
                  lastName: thread.contactLastName,
                }),
              }
            : null,
        messageCount: thread.messageCount,
        lastMessageAt: thread.lastMessageAt,
        messages: messages.map(({ snippet, body, ...message }) => ({
          ...message,
          body: (body ?? snippet)?.slice(0, BODY_LIMIT) ?? null,
        })),
      };
    }),
  );
}

/** Meetings matching `where`, newest first, with their attendees. */
async function meetingsWhere(
  organizationId: string,
  where: SQL | undefined,
): Promise<HistoryMeeting[]> {
  const meetings = await db
    .select({
      id: calendarEvent.id,
      title: calendarEvent.title,
      startsAt: calendarEvent.startsAt,
    })
    .from(calendarEvent)
    .where(and(eq(calendarEvent.organizationId, organizationId), where))
    .orderBy(desc(calendarEvent.startsAt))
    .limit(10);
  if (meetings.length === 0) return [];
  const attendees = await db
    .select({
      eventId: calendarAttendee.eventId,
      email: calendarAttendee.email,
      name: calendarAttendee.name,
      contactId: calendarAttendee.contactId,
      responseStatus: calendarAttendee.responseStatus,
    })
    .from(calendarAttendee)
    .where(
      and(
        eq(calendarAttendee.organizationId, organizationId),
        inArray(
          calendarAttendee.eventId,
          meetings.map((meeting) => meeting.id),
        ),
      ),
    );
  const now = new Date().toISOString();
  return meetings.map((meeting) => ({
    title: meeting.title,
    startsAt: meeting.startsAt,
    upcoming: meeting.startsAt > now,
    attendees: attendees
      .filter((attendee) => attendee.eventId === meeting.id)
      .map(({ eventId: _eventId, ...attendee }) => attendee),
  }));
}

/** Meetings with any of `contactIds` (as organizer contact or attendee). */
function meetingWith(
  organizationId: string,
  contactIds: SQLWrapper | string[],
): SQL | undefined {
  return or(
    inArray(calendarEvent.contactId, contactIds),
    inArray(
      calendarEvent.id,
      db
        .select({ id: calendarAttendee.eventId })
        .from(calendarAttendee)
        .where(
          and(
            eq(calendarAttendee.organizationId, organizationId),
            inArray(calendarAttendee.contactId, contactIds),
          ),
        ),
    ),
  );
}

async function notesFor(organizationId: string, where: SQL) {
  const rows = await db
    .select({
      type: activity.type,
      subject: activity.subject,
      body: activity.body,
      occurredAt: activity.occurredAt,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.organizationId, organizationId),
        where,
        inArray(activity.type, [...NOTE_TYPES]),
      ),
    )
    .orderBy(desc(activity.createdAt))
    .limit(10);
  return rows.map((row) => ({
    type: row.type,
    subject: row.subject,
    body: row.body ? row.body.slice(0, BODY_LIMIT) : null,
    occurredAt: row.occurredAt ?? row.createdAt,
  }));
}

/** The latest message from their side among threads matching `threads`. */
async function lastInbound(organizationId: string, threads: SQL | undefined) {
  const [row] = await db
    .select({
      sentAt: emailMessage.sentAt,
      fromEmail: emailMessage.fromEmail,
      fromName: emailMessage.fromName,
    })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        eq(emailMessage.direction, "INBOUND"),
        inArray(
          emailMessage.threadId,
          db
            .select({ id: emailThread.id })
            .from(emailThread)
            .where(
              and(eq(emailThread.organizationId, organizationId), threads),
            ),
        ),
      ),
    )
    .orderBy(desc(emailMessage.sentAt))
    .limit(1);
  return row ?? null;
}

function nextMeetingAt(meetings: HistoryMeeting[]): string | null {
  const upcoming = meetings
    .filter((meeting) => meeting.upcoming)
    .map((meeting) => meeting.startsAt);
  return upcoming.length > 0
    ? upcoming.reduce((a, b) => (a < b ? a : b))
    : null;
}

/** Everything the CRM has on a contact. Null when it isn't the organization's. */
async function contactHistory(
  organizationId: string,
  contactId: string,
  options: { threads: number },
) {
  const [row] = await db
    .select({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.domain,
      companyIndustry: company.industry,
    })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [deals, threads, meetings, colleagues] = await Promise.all([
    db
      .select({
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
        role: dealContact.role,
        amount: deal.amount,
        currency: deal.currency,
        expectedCloseDate: deal.expectedCloseDate,
      })
      .from(dealContact)
      .innerJoin(deal, eq(deal.id, dealContact.dealId))
      .where(
        and(
          eq(dealContact.organizationId, organizationId),
          eq(deal.organizationId, organizationId),
          eq(dealContact.contactId, contactId),
        ),
      )
      .orderBy(descNullsLast(deal.lastActivityAt)),
    threadsWhere(
      organizationId,
      eq(emailThread.contactId, contactId),
      options.threads,
      6,
    ),
    meetingsWhere(organizationId, meetingWith(organizationId, [contactId])),
    row.companyId
      ? db
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
              eq(contact.companyId, row.companyId),
              ne(contact.id, contactId),
              isNull(contact.archivedAt),
            ),
          )
          .orderBy(descNullsLast(contact.lastActivityAt))
          .limit(8)
      : [],
  ]);
  const inbound = threads
    .flatMap((thread) => thread.messages)
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.sentAt);
  return {
    contact: {
      fullName: name(row),
      email: row.email,
      title: row.title,
      company:
        row.companyId && row.companyName
          ? {
              id: row.companyId,
              name: row.companyName,
              domain: row.companyDomain,
              industry: row.companyIndustry,
            }
          : null,
    },
    deals,
    threads,
    meetings: meetings.map((meeting) => ({
      ...meeting,
      attended: meeting.attendees.some(
        (attendee) =>
          attendee.contactId === contactId &&
          attendee.responseStatus === "accepted",
      ),
    })),
    stats: {
      emails: threads.reduce((total, thread) => total + thread.messageCount, 0),
      theyReplied: inbound.length > 0,
      lastReplyAt:
        inbound.length > 0 ? inbound.reduce((a, b) => (a > b ? a : b)) : null,
      meetings: meetings.length,
      nextMeetingAt: nextMeetingAt(meetings),
    },
    colleagues: colleagues.map((colleague) => ({
      id: colleague.id,
      name: name(colleague),
      title: colleague.title,
    })),
  };
}

export const AgentHistoryRepository = {
  threadsWhere,
  meetingsWhere,
  meetingWith,
  notesFor,
  lastInbound,
  nextMeetingAt,
  contactHistory,
  name,
};
