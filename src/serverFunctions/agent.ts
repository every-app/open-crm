import { createServerFn } from "@tanstack/react-start";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { enrichmentQueueSchema } from "@/types/schemas/agent";

export const getEnrichmentQueue = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(enrichmentQueueSchema)
  .handler(async ({ data, context }) =>
    EnrichmentQueueService.queue(context.organizationId, data.limit),
  );
