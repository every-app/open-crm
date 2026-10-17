import { useState } from "react";
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
import type { RecordRef } from "@/shared/records";

// A record's Activity tab: the composer, the views, and the timeline. The
// All view pins the open tasks above everything else that happened.

const TABS = ["all", "notes", "email", "meetings", "upcoming", "done"] as const;
type TimelineTab = (typeof TABS)[number];

const TAB_LABELS: Record<TimelineTab, string> = {
  all: "All",
  notes: "Notes",
  email: "Email",
  meetings: "Meetings",
  upcoming: "Upcoming",
  done: "Done",
};

const EMPTY: Record<
  TimelineTab,
  { icon: LucideIcon; title: string; description: string }
> = {
  all: {
    icon: Clock,
    title: "Nothing has happened yet",
    description:
      "Calls, notes, emails and meetings all land here. Log the first one above, or wait for Gmail, Outlook and Calendar to sync.",
  },
  notes: {
    icon: MessageSquare,
    title: "No notes",
    description:
      "Notes are what you write down for the next person to read — what they care about, who else is involved, what you promised.",
  },
  email: {
    icon: Mail,
    title: "No email",
    description:
      "Threads appear here as they are synced from Gmail or Outlook. Nothing from before this mailbox was connected is imported.",
  },
  meetings: {
    icon: CalendarDays,
    title: "No meetings",
    description:
      "Calendar events with someone from this record on them show up here, past and upcoming.",
  },
  upcoming: {
    icon: SquareCheck,
    title: "Nothing outstanding",
    description:
      "Tasks you have not finished appear here, and at the top of the All tab until they are done.",
  },
  done: {
    icon: CircleCheck,
    title: "Nothing finished yet",
    description: "Tasks move here once you tick them off.",
  },
};

function isTab(value: unknown): value is TimelineTab {
  return TABS.some((tab) => tab === value);
}

/**
 * A record's timeline (notes, calls, tasks, emails, meetings, stage changes
 * and what the agent found) with its composer.
 */
export function RecordTimeline({ record }: { record: RecordRef }) {
  const [tab, setTab] = useState<TimelineTab>("all");
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
            if (isTab(picked)) setTab(picked);
          }}
          aria-label="Which activities to show"
          className="flex-wrap"
        >
          {TABS.map((option) => (
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
              description={EMPTY[tab].description}
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
