import { z } from "zod";

/** What an owner's full export holds: one CSV of each. */
export const EXPORT_DATASETS = [
  "companies",
  "contacts",
  "deals",
  "notes",
  "tasks",
  "emails",
  "meetings",
  "website-activity",
  "form-submissions",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** One page of one dataset, after the last row of the page before. */
export const exportPageSchema = z.object({
  dataset: z.enum(EXPORT_DATASETS),
  cursor: z.string().min(1).max(256).nullable(),
});
