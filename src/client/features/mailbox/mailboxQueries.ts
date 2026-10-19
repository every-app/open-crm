import { queryOptions } from "@tanstack/react-query";
import {
  getConnections,
  getMemberConnections,
} from "@/serverFunctions/mailbox";

/** The member's mailbox connections and how each source's sync is doing. */
export const connectionsQueryOptions = () =>
  queryOptions({
    queryKey: ["mailbox", "connections"],
    queryFn: () => getConnections(),
  });

/** Every member's mailbox connections, for owners and admins. */
export const memberConnectionsQueryOptions = () =>
  queryOptions({
    queryKey: ["mailbox", "members"],
    queryFn: () => getMemberConnections(),
  });
