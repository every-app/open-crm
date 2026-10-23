import { queryOptions } from "@tanstack/react-query";
import { getSetupChecklist } from "@/serverFunctions/setup";

/** The gateway's keys for the agent; they change on the gateway. */
export const setupChecklistQueryOptions = () =>
  queryOptions({
    queryKey: ["setup", "checklist"],
    queryFn: () => getSetupChecklist(),
    staleTime: 60_000,
  });
