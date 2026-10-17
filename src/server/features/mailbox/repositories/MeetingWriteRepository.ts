import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  activity,
  calendarAttendee,
  calendarEvent,
  contactBrief,
} from "@/db/schema";
// Captured meetings: calendar_event, calendar_attendee and their one MEETING
// activity each. Every statement names the organization.

/** Removes a cancelled meeting (its attendees and activity cascade). */
async function deleteEvent(
  organizationId: string,
  iCalUid: string,
  originalStartTime: string,
): Promise<boolean> {
  const rows = await db
    .delete(calendarEvent)
    .where(
      and(
        eq(calendarEvent.organizationId, organizationId),
        eq(calendarEvent.iCalUid, iCalUid),
        eq(calendarEvent.originalStartTime, originalStartTime),
      ),
    )
    .returning({ id: calendarEvent.id });
  return rows.length > 0;
}

/** Removes a cancelled meeting the member synced, known only by Google's id. */
async function deleteGoogleEvent(
  organizationId: string,
  userId: string,
  googleEventId: string,
) {
  await db
    .delete(calendarEvent)
    .where(
      and(
        eq(calendarEvent.organizationId, organizationId),
        eq(calendarEvent.syncedByUserId, userId),
        eq(calendarEvent.googleEventId, googleEventId),
      ),
    );
}

type EventValues = {
  organizationId: string;
  iCalUid: string;
  originalStartTime: string;
  recurringEventId: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  conferenceUrl: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  status: string;
  organizerEmail: string | null;
  companyId: string | null;
  contactId: string | null;
  syncedByUserId: string;
  googleEventId: string | null;
};

/** Stores the meeting, or brings the stored one up to date; its id. */
async function upsertEvent(values: EventValues): Promise<string> {
  const rest = values;
  const [row] = await db
    .insert(calendarEvent)
    .values({ id: crypto.randomUUID(), ...values })
    .onConflictDoUpdate({
      target: [
        calendarEvent.organizationId,
        calendarEvent.iCalUid,
        calendarEvent.originalStartTime,
      ],
      set: {
        title: rest.title,
        description: rest.description,
        location: rest.location,
        conferenceUrl: rest.conferenceUrl,
        startsAt: rest.startsAt,
        endsAt: rest.endsAt,
        isAllDay: rest.isAllDay,
        status: rest.status,
        organizerEmail: rest.organizerEmail,
        companyId: rest.companyId,
        contactId: rest.contactId,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning({ id: calendarEvent.id });
  if (!row) throw new Error("Calendar event missing after upsert");
  return row.id;
}

/** Stores the meeting's people, each linked to their contact when there is one. */
async function upsertAttendees(
  organizationId: string,
  eventId: string,
  attendees: {
    email: string;
    name: string | null;
    responseStatus: string | null;
    isOrganizer: boolean;
    contactId: string | null;
  }[],
) {
  if (attendees.length === 0) return;
  await runBatch((tx) =>
    attendees.map((attendee) =>
      tx
        .insert(calendarAttendee)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          eventId,
          ...attendee,
        })
        .onConflictDoUpdate({
          target: [calendarAttendee.eventId, calendarAttendee.email],
          set: {
            name: attendee.name,
            responseStatus: attendee.responseStatus,
            isOrganizer: attendee.isOrganizer,
            contactId: attendee.contactId,
          },
        }),
    ),
  );
}

/** The meeting's contacts the agent has written no brief on. */
async function attendeesWithoutBrief(
  organizationId: string,
  eventId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ contactId: calendarAttendee.contactId })
    .from(calendarAttendee)
    .leftJoin(
      contactBrief,
      and(
        eq(contactBrief.contactId, calendarAttendee.contactId),
        eq(contactBrief.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(calendarAttendee.organizationId, organizationId),
        eq(calendarAttendee.eventId, eventId),
        isNotNull(calendarAttendee.contactId),
        isNull(contactBrief.contactId),
      ),
    );
  return rows.flatMap((row) => (row.contactId ? [row.contactId] : []));
}

/** The meeting's one MEETING activity; its creation time. */
async function projectEvent(input: {
  organizationId: string;
  eventId: string;
  userId: string;
  title: string;
  location: string | null;
  startsAt: string;
  companyId: string | null;
  contactId: string | null;
}): Promise<string> {
  const body = input.location ? `Location: ${input.location}` : null;
  const [row] = await db
    .insert(activity)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      type: "MEETING",
      subject: input.title,
      body,
      occurredAt: input.startsAt,
      companyId: input.companyId,
      contactId: input.contactId,
      createdById: input.userId,
      calendarEventId: input.eventId,
      meta: { synced: true, source: "calendar" },
    })
    .onConflictDoUpdate({
      target: activity.calendarEventId,
      set: {
        subject: input.title,
        body,
        occurredAt: input.startsAt,
        companyId: input.companyId,
        contactId: input.contactId,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning({ createdAt: activity.createdAt });
  if (!row) throw new Error("Meeting activity missing after upsert");
  return row.createdAt;
}

export const MeetingWriteRepository = {
  deleteEvent,
  deleteGoogleEvent,
  upsertEvent,
  upsertAttendees,
  attendeesWithoutBrief,
  projectEvent,
};
