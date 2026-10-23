import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getEnrichmentQueue } from "@/serverFunctions/agent";

// Every agent query lives under ["agent"]. The agent works in the background,
// so what it is doing is polled while it works (3s, as record lists poll a
// record being enriched) and, for the queue, slowly otherwise.

const WORKING_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

const agentKeys = {
  all: ["agent"] as const,
  queue: (limit: number) => ["agent", "queue", limit] as const,
};

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
