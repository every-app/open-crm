import { createServerFn } from "@tanstack/react-start";
import { SearchService } from "@/server/features/search/services/SearchService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { quickSearchSchema } from "@/types/schemas/search";

export const quickSearch = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(quickSearchSchema)
  .handler(({ data, context }) =>
    SearchService.quick(context.organizationId, data.q),
  );
