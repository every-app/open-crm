import { z } from "zod";
import { MeetingWriteRepository } from "@/server/features/mailbox/repositories/MeetingWriteRepository";
import {
  CaptureService,
  type IncomingEvent,
} from "@/server/features/mailbox/services/CaptureService";
import { budgetLeft, mailboxGet } from "./mailboxApi";
import { failureOf, type SyncJob, type SyncResult } from "./syncJob";

// Google Calendar, read-only, ported from the CRM's calendar.client.ts and
// calendar-sync.service.ts. The first check reads the meetings from now to
// 180 days out; later ones read only what changed since its sync token. Up
// to five pages per check; a cancelled meeting is deleted.

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";

const MAX_PAGES_PER_CHECK = 5;
const HORIZON_DAYS = 180;

const timeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
});

const personSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
});

const eventSchema = z.object({
  id: z.string().optional(),
  iCalUID: z.string().optional(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  hangoutLink: z.string().optional(),
  recurringEventId: z.string().optional(),
  start: timeSchema.optional(),
  end: timeSchema.optional(),
  originalStartTime: timeSchema.optional(),
  organizer: personSchema.optional(),
  attendees: z
    .array(
      personSchema.extend({
        responseStatus: z.string().optional(),
        organizer: z.boolean().optional(),
        self: z.boolean().optional(),
        resource: z.boolean().optional(),
      }),
    )
    .optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string().optional(),
            uri: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

type GoogleEvent = z.infer<typeof eventSchema>;

const pageSchema = z.object({
  items: z.array(eventSchema).optional(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

const calendarSchema = z.object({ id: z.string().optional() });

/** The primary calendar's id: its owner's address. */
export async function primaryCalendar(
  accessToken: string,
  budget: SyncJob["budget"],
) {
  return mailboxGet(BASE, accessToken, calendarSchema, budget);
}

export async function syncCalendar(job: SyncJob): Promise<SyncResult> {
  const { row, accessToken, budget } = job;
  const syncToken = row.cursor ?? undefined;
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_CHECK; page += 1) {
    if (!budgetLeft(budget)) break;
    const result = await mailboxGet(
      `${BASE}/events`,
      accessToken,
      pageSchema,
      budget,
      {
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        syncToken,
        pageToken,
        ...(syncToken
          ? {}
          : { timeMin: now.toISOString(), timeMax: horizon.toISOString() }),
      },
    );
    if (result.outcome === "cursor-invalid") {
      // The sync token expired: the next check re-reads the window.
      console.warn("[mailbox] calendar sync token expired", {
        organizationId: row.organizationId,
        userId: row.userId,
      });
      return { status: "IDLE", cursor: null };
    }
    if (result.outcome !== "ok") return failureOf(result);

    for (const item of result.data.items ?? []) {
      // A cancelled occurrence may carry only its id.
      if (item.status === "cancelled" && !item.iCalUID && item.id) {
        await MeetingWriteRepository.deleteGoogleEvent(
          row.organizationId,
          row.userId,
          item.id,
        );
        continue;
      }
      const event = parseEvent(item);
      if (event) {
        await CaptureService.applyEvent(
          job.capture,
          event,
          await job.context(),
        );
      }
    }

    pageToken = result.data.nextPageToken;
    if (!pageToken) {
      return {
        status: "IDLE",
        cursor: result.data.nextSyncToken ?? syncToken ?? null,
      };
    }
  }
  // Out of pages for this check: the next one starts over from the cursor.
  return { status: "IDLE" };
}

function eventTime(
  time: z.infer<typeof timeSchema> | undefined,
): { at: string; isAllDay: boolean } | null {
  if (time?.dateTime) {
    const at = new Date(time.dateTime);
    return Number.isNaN(at.getTime())
      ? null
      : { at: at.toISOString(), isAllDay: false };
  }
  if (time?.date) {
    const at = new Date(`${time.date}T00:00:00Z`);
    return Number.isNaN(at.getTime())
      ? null
      : { at: at.toISOString(), isAllDay: true };
  }
  return null;
}

function conferenceUrl(event: GoogleEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const entry = event.conferenceData?.entryPoints?.find(
    (point) => point.entryPointType === "video" && point.uri,
  );
  return entry?.uri ?? null;
}

/** A Google event as the pipeline files it; null without its identity or times. */
function parseEvent(event: GoogleEvent): IncomingEvent | null {
  if (!event.iCalUID) return null;
  const start = eventTime(event.start);
  const originalStart = eventTime(event.originalStartTime) ?? start;
  if (!originalStart) return null;
  const cancelled = event.status === "cancelled";
  const end = eventTime(event.end);
  if (!cancelled && (!start || !end)) return null;
  const organizer = event.organizer?.email
    ? {
        email: event.organizer.email.toLowerCase(),
        name: event.organizer.displayName ?? null,
      }
    : null;
  return {
    iCalUid: event.iCalUID,
    originalStartTime: originalStart.at,
    cancelled,
    recurringEventId: event.recurringEventId ?? null,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    conferenceUrl: conferenceUrl(event),
    startsAt: start?.at ?? originalStart.at,
    endsAt: end?.at ?? originalStart.at,
    isAllDay: start?.isAllDay ?? false,
    status: event.status ?? "confirmed",
    organizer,
    attendees: (event.attendees ?? []).flatMap((attendee) =>
      attendee.email
        ? [
            {
              email: attendee.email.toLowerCase(),
              name: attendee.displayName ?? null,
              responseStatus: attendee.responseStatus ?? null,
              isOrganizer: attendee.organizer ?? false,
              isResource: attendee.resource ?? false,
              isSelf: attendee.self ?? false,
            },
          ]
        : [],
    ),
    googleEventId: event.id ?? null,
  };
}
