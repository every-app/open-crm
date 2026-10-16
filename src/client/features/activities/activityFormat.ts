import {
  ArrowRight,
  CalendarDays,
  Mail,
  MessageSquare,
  Phone,
  SquareCheck,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import { STAGE_LABELS } from "@/client/features/companies/companyFormat";
import { DEAL_STAGES, type ActivityType } from "@/shared/crm-enums";
import type { getTimeline } from "@/serverFunctions/activities";

// How an activity reads: its icon and name, who wrote it, its headline, and
// the day it sits under on a timeline.

export type ActivityEntry = Awaited<
  ReturnType<typeof getTimeline>
>["entries"][number];

export const ACTIVITY_PRESENTATION: Record<
  ActivityType,
  { label: string; icon: LucideIcon }
> = {
  NOTE: { label: "Note", icon: MessageSquare },
  CALL: { label: "Call", icon: Phone },
  EMAIL: { label: "Email", icon: Mail },
  MEETING: { label: "Meeting", icon: CalendarDays },
  TASK: { label: "Task", icon: SquareCheck },
  STAGE_CHANGE: { label: "Stage change", icon: ArrowRight },
  ENRICHMENT: { label: "Enrichment", icon: WandSparkles },
};

const stageChangeSchema = z
  .object({ from: z.enum(DEAL_STAGES), to: z.enum(DEAL_STAGES) })
  .nullable()
  .catch(null);

/** A deal's move between stages, from a STAGE_CHANGE's meta. */
function stageChange(entry: ActivityEntry) {
  return entry.type === "STAGE_CHANGE"
    ? stageChangeSchema.parse(entry.meta)
    : null;
}

/** The line an activity leads with: a stage move, its subject, or nothing. */
export function activityHeadline(entry: ActivityEntry): string | null {
  const change = stageChange(entry);
  return change
    ? `${STAGE_LABELS[change.from]} → ${STAGE_LABELS[change.to]}`
    : entry.subject;
}

/** Who logged it: a person, the agent, or the capture that brought it in. */
export function activityAuthor(entry: ActivityEntry): string {
  if (entry.meta?.synced === true) {
    return entry.emailThread ? "via email" : "via calendar";
  }
  return entry.createdBy?.name ?? "Agent";
}

/** When it sits on a timeline: when it happened, else when it was logged. */
export function activityTime(entry: ActivityEntry): string {
  return entry.occurredAt ?? entry.createdAt;
}

/**
 * The end of a calendar day ("2026-10-20") in the reader's time zone, as
 * ISO: a task due that day isn't overdue until the day is over.
 */
export function endOfLocalDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(
    year ?? 0,
    (month ?? 1) - 1,
    date ?? 1,
    23,
    59,
    59,
    999,
  ).toISOString();
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The reader's calendar day of an instant. */
function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function dayLabel(day: string): string {
  const now = new Date();
  if (day === localDay(now.toISOString())) return "Today";
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  if (day === localDay(yesterday.toISOString())) return "Yesterday";
  return DAY.format(new Date(`${day}T00:00:00`));
}

/** Entries under the reader's days, in the order they came. */
export function byDay(entries: ActivityEntry[]) {
  const groups = new Map<
    string,
    { day: string; label: string; entries: ActivityEntry[] }
  >();
  for (const entry of entries) {
    const day = localDay(activityTime(entry));
    const group = groups.get(day);
    if (group) group.entries.push(entry);
    else groups.set(day, { day, label: dayLabel(day), entries: [entry] });
  }
  return [...groups.values()];
}
