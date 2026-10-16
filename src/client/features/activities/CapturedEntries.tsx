import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  emailThreadQueryOptions,
  meetingQueryOptions,
} from "@/client/features/activities/activityQueries";
import type { ActivityEntry } from "@/client/features/activities/activityFormat";
import { PersonAvatar } from "@/client/features/records/cells";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { safeHttpUrl } from "@/shared/safe-url";

// What mail and calendar capture brought in behind an EMAIL or MEETING
// entry: the thread's messages, read when someone opens them, and the
// meeting's time, attendees and call link.

const MESSAGE_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MEETING_DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const VISIBLE_ATTENDEES = 5;

const RESPONSES: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No reply",
};

/** An email entry's messages, behind "3 messages". */
export function EmailThreadMessages({
  thread,
}: {
  thread: NonNullable<ActivityEntry["emailThread"]>;
}) {
  const [opened, setOpened] = useState(false);
  const query = useQuery({
    ...emailThreadQueryOptions(thread.id),
    enabled: opened,
  });
  return (
    <Collapsible
      onOpenChange={(open) => {
        if (open) setOpened(true);
      }}
    >
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {thread.messageCount === 1
          ? "1 message"
          : `${thread.messageCount} messages`}
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        {query.isPending ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : query.isError ? (
          <p className="text-xs text-muted-foreground">
            {getStandardErrorMessage(query.error)}
          </p>
        ) : (
          query.data.messages.map((message) => {
            const from = message.fromName ?? message.fromEmail;
            return (
              <article
                key={message.id}
                className={cn(
                  "flex gap-2.5 border-l-2 py-2 pl-3",
                  message.direction === "OUTBOUND"
                    ? "border-l-foreground/30"
                    : "border-l-border",
                )}
              >
                <PersonAvatar
                  src={message.fromImageUrl}
                  name={from}
                  size="sm"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">{from}</span>
                    <span className="truncate text-muted-foreground">
                      {message.fromEmail}
                    </span>
                    <time
                      dateTime={message.sentAt}
                      className="ml-auto text-muted-foreground"
                    >
                      {MESSAGE_TIME.format(new Date(message.sentAt))}
                    </time>
                  </div>
                  {message.body ? (
                    <p className="text-pretty whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                      {message.body}
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      No message body.
                    </p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A meeting entry's time, attendees and call link. */
export function MeetingDetails({
  event,
}: {
  event: NonNullable<ActivityEntry["calendarEvent"]>;
}) {
  const query = useQuery({
    ...meetingQueryOptions(event.id),
    enabled: event.attendeeCount > 0,
  });
  const attendees = query.data?.attendees ?? [];
  const shown = attendees.slice(0, VISIBLE_ATTENDEES);
  const joinUrl = safeHttpUrl(event.conferenceUrl);
  const start = new Date(event.startsAt);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span>
        {event.isAllDay
          ? `${MEETING_DAY.format(start)} · All day`
          : MESSAGE_TIME.formatRange(start, new Date(event.endsAt))}
      </span>
      {shown.length > 0 ? (
        <span className="flex items-center gap-1">
          {shown.map((attendee) => (
            <Tooltip key={attendee.id}>
              <TooltipTrigger render={<span />}>
                <PersonAvatar
                  src={attendee.imageUrl}
                  name={attendee.name ?? attendee.email}
                  size="sm"
                />
              </TooltipTrigger>
              <TooltipContent>
                {attendee.name ?? attendee.email} ·{" "}
                {RESPONSES[attendee.responseStatus ?? "needsAction"] ??
                  "No reply"}
              </TooltipContent>
            </Tooltip>
          ))}
          {attendees.length > shown.length ? (
            <span>+{attendees.length - shown.length}</span>
          ) : null}
        </span>
      ) : null}
      {event.location && !joinUrl ? <span>{event.location}</span> : null}
      {joinUrl ? (
        <a
          href={joinUrl}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-3 hover:text-foreground"
        >
          Join call
        </a>
      ) : null}
    </div>
  );
}
