import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { snippetOf } from "@/server/features/mailbox/lib/messageText";
import { isMachineAddress, type Participant } from "@/shared/participants";
import { CaptureWriteRepository } from "@/server/features/mailbox/repositories/CaptureWriteRepository";
import { MeetingWriteRepository } from "@/server/features/mailbox/repositories/MeetingWriteRepository";
import {
  MatchService,
  type MatchContext,
} from "@/server/features/mailbox/services/MatchService";
import type { SyncSource } from "@/shared/mailbox";

// Filing what a mailbox brought in, ported from the CRM's
// ThreadWriterService and CalendarSyncService.apply. Gmail and Outlook each
// parse their own wire format down to one IncomingMessage, so matching,
// threading, counting and stamping happen once: a rule like "reply before
// you create a company" can't hold in one inbox and not the other.

/** The mailbox a check reads, and what its source may do. */
export type CaptureJob = {
  organizationId: string;
  userId: string;
  /** The mailbox's own address, lowercased. */
  mailbox: string;
  autoCreate: boolean;
  origin: SyncSource;
};

export type IncomingMessage = {
  rfcMessageId: string;
  rootId: string;
  subject: string | null;
  from: Participant;
  recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
  body: string;
  sentAt: string;
  gmailMessageId?: string | null;
  outlookMessageId?: string | null;
  outlookWebLink?: string | null;
};

/**
 * Files one message: onto its conversation's thread when the organization
 * already has one, else onto the match (a new company only when the
 * mailbox's owner has written in the conversation, and their source may add
 * records). True when a new message was stored. A message stored without
 * its activity (a check cut short) is repaired, not stored again.
 */
async function storeMessage(
  job: CaptureJob,
  message: IncomingMessage,
  context: MatchContext,
): Promise<boolean> {
  const { organizationId } = job;
  const existing = await CaptureWriteRepository.messageByRfc(
    organizationId,
    message.rfcMessageId,
  );
  if (existing?.activityId) return false;

  const outbound = message.from.email === job.mailbox;
  const thread =
    existing ??
    (await CaptureWriteRepository.threadByRoot(organizationId, message.rootId));
  let companyId = thread?.companyId ?? null;
  let contactId = thread?.contactId ?? null;

  if (!thread) {
    const repliedTo =
      outbound ||
      (await CaptureWriteRepository.hasSentInThread(
        organizationId,
        message.rootId,
        job.mailbox,
      ));
    const match = await MatchService.resolve(
      organizationId,
      {
        participants: [message.from, ...message.recipients],
        allowCreate: job.autoCreate && repliedTo,
        source: "EMAIL",
        ownerId: job.userId,
      },
      context,
    );
    if (!match.companyId && !match.contactId) return false;
    companyId = match.companyId;
    contactId = match.contactId;
  }

  const threadId =
    existing?.threadId ??
    (await CaptureWriteRepository.upsertThread({
      organizationId,
      rootMessageId: message.rootId,
      subject: message.subject,
      companyId,
      contactId,
      sentAt: message.sentAt,
    }));
  const snippet = snippetOf(message.body);
  const inserted = existing
    ? false
    : await CaptureWriteRepository.insertMessage({
        organizationId,
        threadId,
        rfcMessageId: message.rfcMessageId,
        syncedByUserId: job.userId,
        direction: outbound ? "OUTBOUND" : "INBOUND",
        fromEmail: message.from.email,
        fromName: message.from.name,
        recipients: message.recipients,
        subject: message.subject,
        snippet,
        body: message.body || null,
        sentAt: message.sentAt,
        gmailMessageId: message.gmailMessageId ?? null,
        outlookMessageId: message.outlookMessageId ?? null,
        outlookWebLink: message.outlookWebLink ?? null,
      });
  const createdAt = await CaptureWriteRepository.projectThread({
    organizationId,
    threadId,
    userId: job.userId,
    message: { subject: message.subject, snippet, sentAt: message.sentAt },
    companyId,
    contactId,
    origin: job.origin,
  });
  await CaptureWriteRepository.stamp(
    organizationId,
    { companyId, contactId },
    createdAt,
  );
  return inserted;
}

export type IncomingEvent = {
  iCalUid: string;
  originalStartTime: string;
  cancelled: boolean;
  recurringEventId: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  conferenceUrl: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  status: string;
  organizer: Participant | null;
  attendees: {
    email: string;
    name: string | null;
    responseStatus: string | null;
    isOrganizer: boolean;
    isResource: boolean;
    isSelf: boolean;
  }[];
  googleEventId: string | null;
};

const MEETING_PREP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Files one meeting, or removes a cancelled one. Rematched on every change;
 * a meeting the mailbox's owner declined adds no records.
 */
async function applyEvent(
  job: CaptureJob,
  event: IncomingEvent,
  context: MatchContext,
): Promise<"written" | "removed" | "ignored"> {
  const { organizationId } = job;
  if (event.cancelled) {
    const removed = await MeetingWriteRepository.deleteEvent(
      organizationId,
      event.iCalUid,
      event.originalStartTime,
    );
    return removed ? "removed" : "ignored";
  }

  const people = event.attendees.filter(
    (attendee) => !attendee.isResource && !isMachineAddress(attendee.email),
  );
  const participants: Participant[] = [
    ...event.attendees
      .filter((attendee) => !attendee.isResource)
      .map(({ email, name }) => ({ email, name })),
    ...(event.organizer ? [event.organizer] : []),
  ];
  const declined = event.attendees.some(
    (attendee) => attendee.isSelf && attendee.responseStatus === "declined",
  );
  const match = await MatchService.resolve(
    organizationId,
    {
      participants,
      allowCreate: job.autoCreate && !declined,
      source: "CALENDAR",
      ownerId: job.userId,
    },
    context,
  );
  if (!match.companyId && !match.contactId) return "ignored";

  const eventId = await MeetingWriteRepository.upsertEvent({
    organizationId,
    iCalUid: event.iCalUid,
    originalStartTime: event.originalStartTime,
    recurringEventId: event.recurringEventId,
    title: event.title,
    description: event.description,
    location: event.location,
    conferenceUrl: event.conferenceUrl,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isAllDay: event.isAllDay,
    status: event.status,
    organizerEmail: event.organizer?.email ?? null,
    companyId: match.companyId,
    contactId: match.contactId,
    syncedByUserId: job.userId,
    googleEventId: event.googleEventId,
  });

  const contacts = await CaptureWriteRepository.contactsByEmail(
    organizationId,
    people.map((attendee) => attendee.email),
  );
  await MeetingWriteRepository.upsertAttendees(
    organizationId,
    eventId,
    people.map((attendee) => ({
      email: attendee.email,
      name: attendee.name,
      responseStatus: attendee.responseStatus,
      isOrganizer: attendee.isOrganizer,
      contactId: contacts.get(attendee.email) ?? null,
    })),
  );

  const startsIn = Date.parse(event.startsAt) - Date.now();
  if (startsIn > 0 && startsIn <= MEETING_PREP_WINDOW_MS) {
    for (const contactId of await MeetingWriteRepository.attendeesWithoutBrief(
      organizationId,
      eventId,
    )) {
      await AgentTaskService.meetingSoon(
        organizationId,
        contactId,
        event.startsAt,
      );
    }
  }

  const createdAt = await MeetingWriteRepository.projectEvent({
    organizationId,
    eventId,
    userId: job.userId,
    title: event.title ?? "Meeting",
    location: event.location,
    startsAt: event.startsAt,
    companyId: match.companyId,
    contactId: match.contactId,
  });
  await CaptureWriteRepository.stamp(organizationId, match, createdAt);
  return "written";
}

export const CaptureService = { storeMessage, applyEvent };
