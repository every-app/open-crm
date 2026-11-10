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
import { ActivityComposer } from "./ActivityComposer";
import { TimelineEntry } from "./TimelineEntry";
import { byDay, type ActivityEntry } from "./activityFormat";
import { timelineQueryOptions } from "./activityQueries";
import {
  useAppSearch,
  useSetAppSearch,
  type TimelineView,
} from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

const VIEWS: { value: TimelineView; label: string; empty: string }[] = [
  { value: "all", label: "All activity", empty: "No activity yet" },
  { value: "notes", label: "Notes", empty: "No notes" },
  { value: "calls", label: "Calls", empty: "No calls" },
  { value: "email", label: "Email", empty: "No email" },
  { value: "meetings", label: "Meetings", empty: "No meetings" },
  { value: "open-tasks", label: "Open tasks", empty: "No open tasks" },
  {
    value: "completed-tasks",
    label: "Completed tasks",
    empty: "No completed tasks",
  },
];

/**
 * The last section of a record's sheet: what to log next, then what has
 * happened, newest first. One menu narrows it to a kind of activity.
 */
export function RecordTimeline({ record }: { record: RecordRef }) {
  const { timeline: view = "all" } = useAppSearch();
  const setSearch = useSetAppSearch();
  const history = useInfiniteQuery(timelineQueryOptions(record, view));
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <section className="space-y-3 px-5 pt-3 pb-4">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Activity
        </h3>
        {/* Nothing to narrow on a record with no activity at all. */}
        {view === "all" && entries.length === 0 ? null : (
          <Select
            items={VIEWS}
            value={view}
            onValueChange={(value) => {
              const next = VIEWS.find((item) => item.value === value);
              if (next)
                setSearch({
                  timeline: next.value === "all" ? undefined : next.value,
                  emailThread: undefined,
                });
            }}
          >
            <SelectTrigger
              aria-label="Show activity"
              size="sm"
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEWS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <ActivityComposer record={record} />
      {history.isPending ? (
        <SkeletonTableRows rows={5} columns={2} />
      ) : history.isError ? (
        <QueryError
          error={history.error}
          fallback="The timeline could not be loaded."
          onRetry={() => void history.refetch()}
          isRetrying={history.isFetching}
        />
      ) : entries.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {VIEWS.find((item) => item.value === view)?.empty}
        </p>
      ) : (
        <div>
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
        </div>
      )}
    </section>
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
      <h4 className="sticky top-0 z-10 bg-popover py-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h4>
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <TimelineEntry key={entry.id} entry={entry} record={record} />
        ))}
      </ul>
    </section>
  );
}
