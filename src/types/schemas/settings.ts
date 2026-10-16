import { z } from "zod";

export const MIN_ARCHIVE_RETENTION_DAYS = 1;
const MAX_ARCHIVE_RETENTION_DAYS = 3650;

/** A model id from OpenRouter's catalog, or null to follow the default. */
export const setAgentModelSchema = z.object({
  modelId: z.string().trim().min(1).max(200).nullable(),
});

export const setArchiveRetentionSchema = z.object({
  days: z
    .number()
    .int("Retention is a whole number of days.")
    .min(
      MIN_ARCHIVE_RETENTION_DAYS,
      `Retention has to be at least ${MIN_ARCHIVE_RETENTION_DAYS} day.`,
    )
    .max(
      MAX_ARCHIVE_RETENTION_DAYS,
      `Retention cannot be longer than ${MAX_ARCHIVE_RETENTION_DAYS} days.`,
    ),
});

/** Settings → Data's retention form, as typed: the days are still text. */
export const archiveRetentionFormSchema = z.object({
  days: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^\d+$/.test(value) &&
        Number(value) >= MIN_ARCHIVE_RETENTION_DAYS &&
        Number(value) <= MAX_ARCHIVE_RETENTION_DAYS,
      `Enter a whole number of days from ${MIN_ARCHIVE_RETENTION_DAYS} to ${MAX_ARCHIVE_RETENTION_DAYS.toLocaleString("en-US")}.`,
    ),
});
