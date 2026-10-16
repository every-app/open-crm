import { z } from "zod";
import { fieldEntitySchema } from "@/types/schemas/fields";

export const SAVED_VIEW_NAME_MAX = 120;

const FILTERS_MAX_LENGTH = 8_000;

/**
 * A list's filter state as the list page keeps it (its search params): any
 * JSON object. The page validates what it gets back with its own schema, so
 * a view saved before the page changed shape can't break it.
 */
export const savedViewFiltersSchema = z
  .record(z.string(), z.json())
  .refine(
    (filters) => JSON.stringify(filters).length <= FILTERS_MAX_LENGTH,
    "These filters are too large to save.",
  );

export type SavedViewFilters = z.infer<typeof savedViewFiltersSchema>;

const id = z.string().min(1).max(64);

const name = z
  .string()
  .trim()
  .min(1, "A view needs a name.")
  .max(SAVED_VIEW_NAME_MAX);

export const listSavedViewsSchema = z.object({ entity: fieldEntitySchema });

export const createSavedViewSchema = z.object({
  entity: fieldEntitySchema,
  name,
  shared: z.boolean().default(false),
  filters: savedViewFiltersSchema,
});

export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = z.object({
  id,
  name: name.optional(),
  shared: z.boolean().optional(),
  filters: savedViewFiltersSchema.optional(),
});

export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;

export const savedViewIdSchema = z.object({ id });
