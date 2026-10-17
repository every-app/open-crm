import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import {
  getSlackMatches,
  getSlackStatus,
  listSlackChannels,
} from "@/serverFunctions/slack";

// Slack queries live under ["slack"]. While Slack is being read (after a
// connect or a refresh), the inventory is polled until the read lands.

const SYNC_POLL_MS = 3_000;

export const slackKeys = {
  all: ["slack"] as const,
};

export const slackStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["slack", "status"],
    queryFn: () => getSlackStatus(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.connected && data.sync === "syncing" ? SYNC_POLL_MS : false;
    },
  });

/** One page of the channels the app can reach, for a picker. */
export const slackChannelsQueryOptions = (search: string, offset = 0) =>
  queryOptions({
    queryKey: ["slack", "channels", search, offset],
    queryFn: () =>
      listSlackChannels({ data: { query: search || undefined, offset } }),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.sync === "syncing" ? SYNC_POLL_MS : false,
  });

/** The channels page by page, as the Slack page loads more of them. */
export const slackChannelPagesQueryOptions = (search: string) =>
  infiniteQueryOptions({
    queryKey: ["slack", "channel-pages", search],
    queryFn: ({ pageParam }) =>
      listSlackChannels({
        data: { query: search || undefined, offset: pageParam },
      }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    // A new search keeps the last list up until its own arrives.
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.sync === "syncing" ? SYNC_POLL_MS : false,
  });

export const slackMatchesQueryOptions = () =>
  queryOptions({
    queryKey: ["slack", "matches"],
    queryFn: () => getSlackMatches(),
    refetchInterval: (query) =>
      query.state.data?.sync === "syncing" ? SYNC_POLL_MS : false,
  });
