import { createServerFn } from "@tanstack/react-start";
import { ExportService } from "@/server/features/exports/services/ExportService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { exportPageSchema } from "@/types/schemas/exports";

// Settings → General's full export, for owners: the browser asks for each
// dataset a page at a time and zips the CSVs itself.

export const getExportPage = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(exportPageSchema)
  .handler(async ({ data, context }) =>
    ExportService.page(context, data.dataset, data.cursor),
  );
