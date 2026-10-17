import { queryOptions } from "@tanstack/react-query";
import { getGetStarted, getSetupChecklist } from "@/serverFunctions/setup";

/** The gateway's keys for the agent; they change on the gateway. */
export const setupChecklistQueryOptions = () =>
  queryOptions({
    queryKey: ["setup", "checklist"],
    queryFn: () => getSetupChecklist(),
    staleTime: 60_000,
  });

/** Overview's Get started steps for the signed-in person. */
export const getStartedQueryOptions = () =>
  queryOptions({
    queryKey: ["setup", "get-started"],
    queryFn: () => getGetStarted(),
    staleTime: 30_000,
  });
