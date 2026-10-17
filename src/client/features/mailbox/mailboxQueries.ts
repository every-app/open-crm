import { queryOptions } from "@tanstack/react-query";
import { getConnections } from "@/serverFunctions/mailbox";

/** The member's mailbox connections and how each source's sync is doing. */
export const connectionsQueryOptions = () =>
  queryOptions({
    queryKey: ["mailbox", "connections"],
    queryFn: () => getConnections(),
  });
