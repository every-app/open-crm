import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  calendarAttendee,
  calendarEvent,
  contact,
  emailMessage,
  emailThread,
  member,
  user,
} from "@/db/schema";
import { idChunks } from "@/server/features/records/recordRules";

// What mail and calendar capture stored behind an EMAIL or MEETING activity:
// a thread's messages and a meeting's attendees, read when someone opens one
// on a timeline. Capture lands in a later phase; until then the tables are
// empty and nothing here is reached.

const recipientSchema = z.object({
  email: z.string(),
  name: z.string().nullable().catch(null),
  kind: z.string().catch("to"),
});

function recipientsOf(value: unknown) {
  return z
    .array(z.unknown())
    .catch([])
    .parse(value)
    .flatMap((entry) => {
      const parsed = recipientSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
}

/**
 * Pictures for the people behind `emails`: the organization's contacts and
 * members who have one, by lowercased address.
 */
async function facesFor(
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const faces = new Map<string, string>();
  for (const part of idChunks(emails.map((email) => email.toLowerCase()))) {
    const [contacts, members] = await Promise.all([
      db
        .select({ email: contact.email, image: contact.imageUrl })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            inArray(contact.email, part),
          ),
        ),
      db
        .select({ email: user.email, image: user.image })
        .from(user)
        .innerJoin(
          member,
          and(
            eq(member.userId, user.id),
            eq(member.organizationId, organizationId),
          ),
        )
        .where(inArray(user.email, part)),
    ]);
    for (const row of [...contacts, ...members]) {
      if (row.email && row.image) faces.set(row.email.toLowerCase(), row.image);
    }
  }
  return faces;
}

/** One of the organization's email threads with its messages, oldest first. */
async function thread(organizationId: string, threadId: string) {
  const [found] = await db
    .select({
      id: emailThread.id,
      subject: emailThread.subject,
      messageCount: emailThread.messageCount,
      firstMessageAt: emailThread.firstMessageAt,
      lastMessageAt: emailThread.lastMessageAt,
    })
    .from(emailThread)
    .where(
      and(
        eq(emailThread.organizationId, organizationId),
        eq(emailThread.id, threadId),
      ),
    )
    .limit(1);
  if (!found) return null;
  const messages = await db
    .select({
      id: emailMessage.id,
      direction: emailMessage.direction,
      fromEmail: emailMessage.fromEmail,
      fromName: emailMessage.fromName,
      recipients: emailMessage.recipients,
      subject: emailMessage.subject,
      snippet: emailMessage.snippet,
      body: emailMessage.body,
      sentAt: emailMessage.sentAt,
    })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        eq(emailMessage.threadId, threadId),
      ),
    )
    .orderBy(asc(emailMessage.sentAt), asc(emailMessage.id));
  const faces = await facesFor(
    organizationId,
    messages.map((message) => message.fromEmail),
  );
  return {
    ...found,
    messages: messages.map((message) => ({
      ...message,
      recipients: recipientsOf(message.recipients),
      fromImageUrl: faces.get(message.fromEmail.toLowerCase()) ?? null,
    })),
  };
}

/** One of the organization's meetings with its attendees, organizer first. */
async function meeting(organizationId: string, eventId: string) {
  const [found] = await db
    .select({
      id: calendarEvent.id,
      title: calendarEvent.title,
      location: calendarEvent.location,
      conferenceUrl: calendarEvent.conferenceUrl,
      startsAt: calendarEvent.startsAt,
      endsAt: calendarEvent.endsAt,
      isAllDay: calendarEvent.isAllDay,
      status: calendarEvent.status,
    })
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.organizationId, organizationId),
        eq(calendarEvent.id, eventId),
      ),
    )
    .limit(1);
  if (!found) return null;
  const attendees = await db
    .select({
      id: calendarAttendee.id,
      email: calendarAttendee.email,
      name: calendarAttendee.name,
      responseStatus: calendarAttendee.responseStatus,
      isOrganizer: calendarAttendee.isOrganizer,
      contactId: calendarAttendee.contactId,
      imageUrl: contact.imageUrl,
    })
    .from(calendarAttendee)
    .leftJoin(
      contact,
      and(
        eq(contact.id, calendarAttendee.contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(calendarAttendee.organizationId, organizationId),
        eq(calendarAttendee.eventId, eventId),
      ),
    )
    .orderBy(desc(calendarAttendee.isOrganizer), asc(calendarAttendee.email));
  return { ...found, attendees };
}

export const CaptureRepository = {
  thread,
  meeting,
};
