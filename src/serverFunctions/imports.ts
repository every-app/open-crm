import { createServerFn } from "@tanstack/react-start";
import { ImportService } from "@/server/features/imports/services/ImportService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { importChunkSchema } from "@/types/schemas/imports";

/**
 * One chunk of a CSV import of companies, contacts or deals. Anyone who
 * adds records may import them.
 */
export const importRecords = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(importChunkSchema)
  .handler(async ({ data, context }) =>
    ImportService.importChunk(context, data),
  );
