import { queryOptions } from "@tanstack/react-query";
import { getSetupChecklist } from "@/serverFunctions/setup";

/** What this gateway has set up for the CRM; it changes on the gateway. */
export const setupChecklistQueryOptions = () =>
  queryOptions({
    queryKey: ["setup", "checklist"],
    queryFn: () => getSetupChecklist(),
    staleTime: 60_000,
  });
