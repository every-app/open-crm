import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { dashboardKeys } from "@/client/features/dashboard/dashboardQueries";
import { dealKeys } from "@/client/features/deals/dealQueries";
import {
  completeTask,
  createActivity,
  getEmailThread,
  getMeeting,
  getTimeline,
  getTimelineCounts,
} from "@/serverFunctions/activities";
import type { RecordRef } from "@/shared/records";
import type {
  CreateActivityInput,
  TimelineFilter,
} from "@/types/schemas/activities";

// Every activity query lives under ["activities"].
export const activityKeys = {
  all: ["activities"] as const,
  timeline: (record: RecordRef, filter: TimelineFilter) =>
    ["activities", "timeline", record.kind, record.id, filter] as const,
  outstanding: (record: RecordRef) =>
    ["activities", "outstanding", record.kind, record.id] as const,
  counts: (record: RecordRef) =>
    ["activities", "counts", record.kind, record.id] as const,
  thread: (id: string) => ["activities", "thread", id] as const,
  meeting: (id: string) => ["activities", "meeting", id] as const,
};

/** A record's timeline view, a page at a time, newest first. */
export const timelineQueryOptions = (
  record: RecordRef,
  filter: TimelineFilter,
) =>
  infiniteQueryOptions({
    queryKey: activityKeys.timeline(record, filter),
    queryFn: ({ pageParam }) =>
      getTimeline({ data: { record, filter, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** The open tasks pinned above a record's whole timeline. */
export const outstandingQueryOptions = (record: RecordRef) =>
  queryOptions({
    queryKey: activityKeys.outstanding(record),
    queryFn: () =>
      getTimeline({ data: { record, filter: "upcoming", limit: 10 } }),
  });

export const timelineCountsQueryOptions = (record: RecordRef) =>
  queryOptions({
    queryKey: activityKeys.counts(record),
    queryFn: () => getTimelineCounts({ data: { record } }),
  });

export const emailThreadQueryOptions = (id: string) =>
  queryOptions({
    queryKey: activityKeys.thread(id),
    queryFn: () => getEmailThread({ data: { id } }),
    staleTime: Infinity,
  });

export const meetingQueryOptions = (id: string) =>
  queryOptions({
    queryKey: activityKeys.meeting(id),
    queryFn: () => getMeeting({ data: { id } }),
  });

/**
 * What an activity write changes: timelines and tasks, Home, and the last
 * activity every record list and sheet shows.
 */
function invalidateAfterActivity(queryClient: QueryClient) {
  return Promise.all(
    [
      activityKeys.all,
      dashboardKeys.all,
      companyKeys.all,
      contactKeys.all,
      dealKeys.all,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/** Logs a note, call, email, meeting or task. */
export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => createActivity({ data: input }),
    onSuccess: () => invalidateAfterActivity(queryClient),
  });
}

/** Ticks a task off, or opens it again. */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; completed: boolean }) =>
      completeTask({ data: input }),
    onSuccess: () => invalidateAfterActivity(queryClient),
  });
}
