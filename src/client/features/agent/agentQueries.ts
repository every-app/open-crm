import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getEnrichmentQueue,
  listAgentActivity,
  listAgentConversations,
} from "@/serverFunctions/agent";
import type { RecordRef } from "@/shared/records";

// Every agent query lives under ["agent"]. The agent works in the background,
// so what it is doing is polled while it works (3s, as record lists poll a
// record being enriched) and, for the queue, slowly otherwise.

const WORKING_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

export const agentKeys = {
  all: ["agent"] as const,
  conversations: (record: RecordRef) =>
    ["agent", "conversations", record.kind, record.id] as const,
  activity: (record: RecordRef) =>
    ["agent", "activity", record.kind, record.id] as const,
  queue: (limit: number) => ["agent", "queue", limit] as const,
};

/**
 * The person's conversations about a record, latest first. One the agent has
 * not named yet is named during or just after its first turn, which may land
 * after the turn's own refetch: poll until it has a name.
 */
export const agentConversationsQueryOptions = (record: RecordRef) =>
  queryOptions({
    queryKey: agentKeys.conversations(record),
    queryFn: () => listAgentConversations({ data: { record } }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (row) => row.title === null && row.messageCount > 0,
      )
        ? WORKING_POLL_MS
        : false,
  });

/**
 * What the agent did about a record (its research runs and the person's
 * conversations) and the tasks it has open there, polled while one is due
 * and nothing holds it back.
 */
export const agentActivityQueryOptions = (record: RecordRef, limit: number) =>
  queryOptions({
    queryKey: [...agentKeys.activity(record), limit],
    queryFn: () => listAgentActivity({ data: { record, limit } }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const now = new Date().toISOString();
      return query.state.data?.openTasks.some(
        (task) => task.dueAt <= now && task.hold === null,
      )
        ? WORKING_POLL_MS
        : false;
    },
  });

/** The organization's queue of agent work, for Home. */
export const enrichmentQueueQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: agentKeys.queue(limit),
    queryFn: () => getEnrichmentQueue({ data: { limit } }),
    // Loading more keeps the rows on screen until the longer page arrives.
    placeholderData: keepPreviousData,
    // Work waiting for the agent's model to be set up isn't progress.
    refetchInterval: (query) =>
      (query.state.data?.total ?? 0) > 0 && !query.state.data?.paused
        ? WORKING_POLL_MS
        : IDLE_POLL_MS,
  });
