import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CircleCheck,
  Clock,
  Mail,
  MessageSquare,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { ActivityComposer } from "@/client/features/activities/ActivityComposer";
import { TimelineEntry } from "@/client/features/activities/TimelineEntry";
import {
  byDay,
  type ActivityEntry,
} from "@/client/features/activities/activityFormat";
import {
  outstandingQueryOptions,
  timelineCountsQueryOptions,
  timelineQueryOptions,
} from "@/client/features/activities/activityQueries";
import {
  TIMELINE_VIEWS,
  useAppSearch,
  useSetAppSearch,
  type TimelineView,
} from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

// A record's Activity tab: the composer, the views, and the timeline. The
// All view pins the open tasks above everything else that happened. The
// view is in the URL (`timeline`).

const TAB_LABELS: Record<TimelineView, string> = {
  all: "All",
  notes: "Notes",
  email: "Email",
  meetings: "Meetings",
  upcoming: "Upcoming",
  done: "Done",
};

const EMPTY: Record<TimelineView, { icon: LucideIcon; title: string }> = {
  all: { icon: Clock, title: "No activity yet" },
  notes: { icon: MessageSquare, title: "No notes" },
  email: { icon: Mail, title: "No email" },
  meetings: { icon: CalendarDays, title: "No meetings" },
  upcoming: { icon: SquareCheck, title: "Nothing outstanding" },
  done: { icon: CircleCheck, title: "Nothing finished yet" },
};

function isView(value: unknown): value is TimelineView {
  return TIMELINE_VIEWS.some((view) => view === value);
}

/**
 * A record's timeline (notes, calls, tasks, emails, meetings, stage changes
 * and what the agent found) with its composer.
 */
export function RecordTimeline({ record }: { record: RecordRef }) {
  const { timeline: tab = "all" } = useAppSearch();
  const setSearch = useSetAppSearch();
  // Another view closes the email thread open on this one.
  const setTab = (next: TimelineView) =>
    setSearch({
      timeline: next === "all" ? undefined : next,
      emailThread: undefined,
    });
  const counts = useQuery(timelineCountsQueryOptions(record));
  const pinned = useQuery({
    ...outstandingQueryOptions(record),
    enabled: tab === "all",
  });
  const history = useInfiniteQuery(
    timelineQueryOptions(record, tab === "all" ? "history" : tab),
  );
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  const outstanding = tab === "all" ? (pinned.data?.entries ?? []) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-5 py-3">
        <ActivityComposer record={record} />
        <ToggleGroup
          size="sm"
          spacing={1}
          value={[tab]}
          onValueChange={(next) => {
            const [picked] = next;
            if (isView(picked)) setTab(picked);
          }}
          aria-label="Which activities to show"
          className="flex-wrap"
        >
          {TIMELINE_VIEWS.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="aria-pressed:bg-primary/15 aria-pressed:text-primary"
            >
              {TAB_LABELS[option]}
              {counts.data?.[option] ? (
                <span className="tabular-nums opacity-60">
                  {counts.data[option]}
                </span>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
        ) : entries.length === 0 && outstanding.length === 0 ? (
          <div className="py-6">
            <EmptyState
              variant="plain"
              size="sm"
              icon={EMPTY[tab].icon}
              title={EMPTY[tab].title}
            />
          </div>
        ) : (
          <>
            {outstanding.length > 0 ? (
              <TimelineDay
                label="Outstanding"
                entries={outstanding}
                record={record}
              />
            ) : null}
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
