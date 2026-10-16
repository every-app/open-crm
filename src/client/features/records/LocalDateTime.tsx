import { formatRelativeTime } from "@/client/lib/relative-time";

// Dates as the reader keeps them: their locale and time zone. The server
// sends ISO timestamps (UTC) and calendar days (YYYY-MM-DD).

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function isValid(date: Date) {
  return !Number.isNaN(date.getTime());
}

/** "3 hours ago", with the exact local date and time on hover. */
export function RelativeTime({ date }: { date: string }) {
  const value = new Date(date);
  if (!isValid(value)) return null;
  return (
    <time dateTime={date} title={DATE_TIME.format(value)}>
      {formatRelativeTime(date)}
    </time>
  );
}

/** A moment in the reader's time zone: "Oct 16, 2026, 3:42 PM". */
export function LocalDateTime({ date }: { date: string }) {
  const value = new Date(date);
  if (!isValid(value)) return null;
  return <time dateTime={date}>{DATE_TIME.format(value)}</time>;
}

/** A calendar day, such as a close date, read in no time zone. */
export function LocalDay({ date }: { date: string }) {
  const day = date.slice(0, 10);
  const value = new Date(`${day}T00:00:00`);
  if (!isValid(value)) return null;
  return <time dateTime={day}>{DAY.format(value)}</time>;
}
