import { queryOptions } from "@tanstack/react-query";
import { listMembers } from "@/serverFunctions/members";

/** The organization's members who have opened the CRM, oldest first. */
export const membersQueryOptions = () =>
  queryOptions({
    queryKey: ["members"],
    queryFn: () => listMembers(),
    staleTime: 5 * 60 * 1000,
  });
