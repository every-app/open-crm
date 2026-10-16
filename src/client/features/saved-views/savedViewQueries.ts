import { queryOptions } from "@tanstack/react-query";
import { listSavedViews } from "@/serverFunctions/savedViews";
import type { FieldEntity } from "@/shared/crm-enums";

/** The entity's views the viewer can apply: their own and shared ones. */
export const savedViewsQueryOptions = (entity: FieldEntity) =>
  queryOptions({
    queryKey: ["savedViews", entity],
    queryFn: () => listSavedViews({ data: { entity } }),
  });
