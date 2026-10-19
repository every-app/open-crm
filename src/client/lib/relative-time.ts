const DAY_MS = 24 * 60 * 60 * 1000;

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["day", DAY_MS],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/**
 * "3 hours ago" for an ISO timestamp, in whole units (rounded down, as the
 * CRM did); "just now" under a minute.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = then - Date.now();
  const absolute = Math.abs(diff);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absolute >= ms) return formatter.format(Math.trunc(diff / ms), unit);
  }
  return "just now";
}

/** A moment's calendar day in the reader's time zone, as a count of days. */
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/**
 * "today", "tomorrow", "in 3 days", "yesterday": the reader's calendar day
 * of an ISO timestamp against today, whatever the time of day.
 */
export function formatRelativeDay(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return formatter.format(dayNumber(then) - dayNumber(new Date()), "day");
}
