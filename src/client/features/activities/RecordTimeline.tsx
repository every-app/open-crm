import { useInfiniteQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { ActivityComposer } from "./ActivityComposer";
import { TimelineEntry } from "./TimelineEntry";
import { byDay, type ActivityEntry } from "./activityFormat";
import { timelineQueryOptions } from "./activityQueries";
import {
  useAppSearch,
  useSetAppSearch,
  type TimelineView,
} from "@/client/features/records/recordStack";
import { TaskDue } from "@/types/schemas/activities";
import type { RecordRef } from "@/shared/records";

const TYPES = [
  { value: "all", label: "All types" },
  { value: "notes", label: "Notes" },
  { value: "calls", label: "Calls" },
  { value: "email", label: "Email" },
  { value: "meetings", label: "Meetings" },
] as const;
const TASK_STATES = [
  { value: "open-tasks", label: "Open" },
  { value: "completed-tasks", label: "Completed" },
] as const;
const DUE = [
  { value: "all", label: "Any due date" },
  { value: TaskDue.Overdue, label: "Overdue" },
  { value: TaskDue.Upcoming, label: "Upcoming" },
  { value: TaskDue.Undated, label: "No due date" },
];
const EMPTY: Record<TimelineView, string> = {
  all: "No activity yet",
  notes: "No notes",
  calls: "No calls",
  email: "No email",
  meetings: "No meetings",
  "open-tasks": "No open tasks",
  "completed-tasks": "No completed tasks",
};

export function RecordTimeline({ record }: { record: RecordRef }) {
  const { timeline: view = "all", due } = useAppSearch();
  const setSearch = useSetAppSearch();
  const tasks = view === "open-tasks" || view === "completed-tasks";
  const shownDue = view === "open-tasks" ? due : undefined;
  const setView = (next: TimelineView) =>
    setSearch({
      timeline: next === "all" ? undefined : next,
      due: undefined,
      emailThread: undefined,
    });
  const history = useInfiniteQuery(
    timelineQueryOptions(record, view, shownDue),
  );
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-5 py-3">
        <ActivityComposer record={record} />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            size="sm"
            value={[tasks ? "tasks" : "all"]}
            onValueChange={([value]) => {
              if (value) setView(value === "tasks" ? "open-tasks" : "all");
            }}
            aria-label="Activity view"
          >
            <ToggleGroupItem value="all">All activity</ToggleGroupItem>
            <ToggleGroupItem value="tasks">Tasks</ToggleGroupItem>
          </ToggleGroup>
          <Select
            items={tasks ? TASK_STATES : TYPES}
            value={view}
            onValueChange={(value) => {
              const selected = [...TYPES, ...TASK_STATES].find(
                (item) => item.value === value,
              );
              if (selected) setView(selected.value);
            }}
          >
            <SelectTrigger
              aria-label={tasks ? "Task status" : "Activity type"}
              size="sm"
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(tasks ? TASK_STATES : TYPES).map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {view === "open-tasks" ? (
            <Select
              items={DUE}
              value={shownDue ?? "all"}
              onValueChange={(value) =>
                setSearch({
                  due: Object.values(TaskDue).find(
                    (window) => window === value,
                  ),
                })
              }
            >
              <SelectTrigger
                aria-label="Task due date"
                size="sm"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUE.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {history.isPending ? (
          <SkeletonTableRows className="py-4" rows={5} columns={2} />
        ) : history.isError ? (
          <div className="py-4">
            <QueryError
              error={history.error}
              fallback="The timeline could not be loaded."
              onRetry={() => void history.refetch()}
              isRetrying={history.isFetching}
            />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {shownDue ? "No tasks match this due date" : EMPTY[view]}
          </p>
        ) : (
          <>
            {byDay(entries).map((group) => (
              <TimelineDay
                key={group.day}
                label={group.label}
                entries={group.entries}
                record={record}
              />
            ))}
            {history.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                pending={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                Show older
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function TimelineDay({
  label,
  entries,
  record,
}: {
  label: string;
  entries: ActivityEntry[];
  record: RecordRef;
}) {
  return (
    <section>
      <h3 className="sticky top-0 z-10 bg-popover py-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h3>
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <TimelineEntry key={entry.id} entry={entry} record={record} />
        ))}
      </ul>
    </section>
  );
}
