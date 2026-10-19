import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activity,
  calendarAttendee,
  calendarEvent,
  company,
  contact,
  deal,
  emailThread,
  user,
} from "@/db/schema";

// How an activity reads everywhere it shows (timelines, My tasks, Home): the
// row with its author and the records, thread and meeting it is about.

/**
 * Where an activity sits on a timeline: when it happened, or when it was
 * written for one that doesn't say.
 */
export function timelineAt() {
  return sql<string>`coalesce(${activity.occurredAt}, ${activity.createdAt})`;
}

const metaSchema = z.record(z.string(), z.json()).nullable().catch(null);

function entryColumns() {
  return {
    id: activity.id,
    type: activity.type,
    subject: activity.subject,
    body: activity.body,
    occurredAt: activity.occurredAt,
    dueAt: activity.dueAt,
    completedAt: activity.completedAt,
    meta: activity.meta,
    createdAt: activity.createdAt,
    at: timelineAt(),
    authorId: user.id,
    authorName: user.name,
    authorEmail: user.email,
    authorImage: user.image,
    companyId: company.id,
    companyName: company.name,
    contactId: contact.id,
    contactFirstName: contact.firstName,
    contactLastName: contact.lastName,
    dealId: deal.id,
    dealName: deal.name,
    threadId: emailThread.id,
    threadMessageCount: emailThread.messageCount,
    threadLastMessageAt: emailThread.lastMessageAt,
    eventId: calendarEvent.id,
    eventStartsAt: calendarEvent.startsAt,
    eventEndsAt: calendarEvent.endsAt,
    eventIsAllDay: calendarEvent.isAllDay,
    eventLocation: calendarEvent.location,
    eventConferenceUrl: calendarEvent.conferenceUrl,
    attendeeCount:
      sql<number>`(select count(*) from ${calendarAttendee} where ${calendarAttendee.eventId} = ${activity.calendarEventId})`.mapWith(
        Number,
      ),
  };
}

/** The activities matching `where`, which names the organization. */
export function selectEntries(where: SQL | undefined) {
  return db
    .select(entryColumns())
    .from(activity)
    .leftJoin(user, eq(user.id, activity.createdById))
    .leftJoin(
      company,
      and(
        eq(company.id, activity.companyId),
        eq(company.organizationId, activity.organizationId),
      ),
    )
    .leftJoin(
      contact,
      and(
        eq(contact.id, activity.contactId),
        eq(contact.organizationId, activity.organizationId),
      ),
    )
    .leftJoin(
      deal,
      and(
        eq(deal.id, activity.dealId),
        eq(deal.organizationId, activity.organizationId),
      ),
    )
    .leftJoin(
      emailThread,
      and(
        eq(emailThread.id, activity.emailThreadId),
        eq(emailThread.organizationId, activity.organizationId),
      ),
    )
    .leftJoin(
      calendarEvent,
      and(
        eq(calendarEvent.id, activity.calendarEventId),
        eq(calendarEvent.organizationId, activity.organizationId),
      ),
    )
    .where(where);
}

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number];

function author(row: EntryRow) {
  if (
    row.authorId === null ||
    row.authorName === null ||
    row.authorEmail === null
  ) {
    return null;
  }
  return {
    id: row.authorId,
    name: row.authorName,
    email: row.authorEmail,
    image: row.authorImage,
  };
}

function meeting(row: EntryRow) {
  if (
    row.eventId === null ||
    row.eventStartsAt === null ||
    row.eventEndsAt === null
  ) {
    return null;
  }
  return {
    id: row.eventId,
    startsAt: row.eventStartsAt,
    endsAt: row.eventEndsAt,
    isAllDay: row.eventIsAllDay ?? false,
    location: row.eventLocation,
    conferenceUrl: row.eventConferenceUrl,
    attendeeCount: row.attendeeCount,
  };
}

export function toEntry(row: EntryRow) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    meta: metaSchema.parse(row.meta),
    createdAt: row.createdAt,
    /** Null when the research agent wrote it. */
    createdBy: author(row),
    company:
      row.companyId !== null && row.companyName !== null
        ? { id: row.companyId, name: row.companyName }
        : null,
    contact:
      row.contactId !== null && row.contactFirstName !== null
        ? {
            id: row.contactId,
            firstName: row.contactFirstName,
            lastName: row.contactLastName,
          }
        : null,
    deal:
      row.dealId !== null && row.dealName !== null
        ? { id: row.dealId, name: row.dealName }
        : null,
    emailThread:
      row.threadId !== null &&
      row.threadMessageCount !== null &&
      row.threadLastMessageAt !== null
        ? {
            id: row.threadId,
            messageCount: row.threadMessageCount,
            lastMessageAt: row.threadLastMessageAt,
          }
        : null,
    calendarEvent: meeting(row),
  };
}

export type ActivityEntry = ReturnType<typeof toEntry>;
