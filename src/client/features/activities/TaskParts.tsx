import { cn } from "cn";
import { Checkbox } from "@/client/components/ui/checkbox";
import { useCompleteTask } from "@/client/features/activities/activityQueries";
import type { ActivityEntry } from "@/client/features/activities/activityFormat";
import { fullName } from "@/client/features/companies/companyFormat";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";

// A task as every list shows it: ticked off in place, due when, and about
// which record.

/** Ticks a task off, or opens it again. */
export function TaskCheckbox({ task }: { task: ActivityEntry }) {
  const complete = useCompleteTask();
  const done = task.completedAt !== null;
  return (
    <Checkbox
      checked={done}
      disabled={complete.isPending}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      onCheckedChange={(checked) =>
        complete.mutate({ id: task.id, completed: checked })
      }
    />
  );
}

/** "Due in 2 days", or "Overdue 3 days ago" in red. */
export function TaskDue({ dueAt }: { dueAt: string }) {
  const overdue = new Date(dueAt) < new Date();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        overdue ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          overdue ? "bg-destructive" : "bg-info",
        )}
      />
      {overdue ? "Overdue" : "Due"} <RelativeTime date={dueAt} />
    </span>
  );
}

/** The record an activity is about: its deal, else its contact or company. */
export function AboutRecord({ entry }: { entry: ActivityEntry }) {
  if (entry.deal) {
    return (
      <RecordLink record={{ kind: "deal", id: entry.deal.id }}>
        {entry.deal.name}
      </RecordLink>
    );
  }
  if (entry.contact) {
    return (
      <RecordLink record={{ kind: "contact", id: entry.contact.id }}>
        {fullName(entry.contact)}
      </RecordLink>
    );
  }
  if (entry.company) {
    return (
      <RecordLink record={{ kind: "company", id: entry.company.id }}>
        {entry.company.name}
      </RecordLink>
    );
  }
  return null;
}
