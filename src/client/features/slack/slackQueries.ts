import { queryOptions } from "@tanstack/react-query";
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

export const slackChannelsQueryOptions = (search: string, offset = 0) =>
  queryOptions({
    queryKey: ["slack", "channels", search, offset],
    queryFn: () =>
      listSlackChannels({ data: { query: search || undefined, offset } }),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.sync === "syncing" ? SYNC_POLL_MS : false,
  });

export const slackMatchesQueryOptions = () =>
  queryOptions({
    queryKey: ["slack", "matches"],
    queryFn: () => getSlackMatches(),
    refetchInterval: (query) =>
      query.state.data?.sync === "syncing" ? SYNC_POLL_MS : false,
  });
