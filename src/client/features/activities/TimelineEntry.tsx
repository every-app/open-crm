import { cn } from "cn";
import {
  EmailThreadMessages,
  MeetingDetails,
} from "@/client/features/activities/CapturedEntries";
import { TaskCheckbox, TaskDue } from "@/client/features/activities/TaskParts";
import {
  ACTIVITY_PRESENTATION,
  activityAuthor,
  activityHeadline,
  activityTime,
  type ActivityEntry,
} from "@/client/features/activities/activityFormat";
import { fullName } from "@/client/features/companies/companyFormat";
import { RecordLink } from "@/client/features/records/RecordLink";
import type { RecordRef } from "@/shared/records";

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const FULL = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * One entry on `record`'s timeline. The deal or person it was logged on
 * links out when it isn't `record` itself.
 */
export function TimelineEntry({
  entry,
  record,
}: {
  entry: ActivityEntry;
  record: RecordRef;
}) {
  const isTask = entry.type === "TASK";
  const done = entry.completedAt !== null;
  const headline = activityHeadline(entry);
  const { label, icon: Icon } = ACTIVITY_PRESENTATION[entry.type];
  const when = new Date(activityTime(entry));
  const deal = entry.deal && entry.deal.id !== record.id ? entry.deal : null;
  const contact =
    entry.contact && entry.contact.id !== record.id ? entry.contact : null;
  const due = isTask && !done ? entry.dueAt : null;

  return (
    <li className="flex gap-2.5 py-2.5 text-sm">
      <span className="mt-0.5 flex shrink-0 text-muted-foreground">
        {isTask ? (
          <TaskCheckbox task={entry} />
        ) : (
          <span role="img" aria-label={label}>
            <Icon className="size-4" />
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            {headline ? (
              <p
                className={cn(
                  "font-medium [overflow-wrap:anywhere]",
                  done && "text-muted-foreground line-through",
                )}
              >
                {headline}
              </p>
            ) : null}
            {entry.body ? (
              <p
                className={cn(
                  "text-pretty whitespace-pre-wrap [overflow-wrap:anywhere]",
                  headline && "text-muted-foreground",
                )}
              >
                {entry.body}
              </p>
            ) : null}
            {!headline && !entry.body ? (
              <p className="text-muted-foreground">{label}</p>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{activityAuthor(entry)} · </span>
            <time
              dateTime={when.toISOString()}
              title={FULL.format(when)}
              className="tabular-nums"
            >
              {TIME.format(when)}
            </time>
          </span>
        </div>

        {entry.calendarEvent ? (
          <MeetingDetails event={entry.calendarEvent} />
        ) : null}
        {entry.emailThread ? (
          <EmailThreadMessages thread={entry.emailThread} />
        ) : null}

        {due || deal || contact ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {due ? <TaskDue dueAt={due} /> : null}
            {deal ? (
              <RecordLink record={{ kind: "deal", id: deal.id }}>
                {deal.name}
              </RecordLink>
            ) : null}
            {contact ? (
              <RecordLink record={{ kind: "contact", id: contact.id }}>
                {fullName(contact)}
              </RecordLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
