import { z } from "zod";
import { FIELD_ENTITIES, FIELD_TYPES } from "@/shared/crm-enums";
import {
  FIELD_BRIEF_MAX,
  FIELD_LABEL_MAX,
  FIELD_OPTION_LABEL_MAX,
  FIELD_OPTIONS_MAX,
} from "@/shared/fields";

export const fieldEntitySchema = z.enum(FIELD_ENTITIES);

const id = z.string().min(1).max(64);

export const listFieldsSchema = z.object({
  entity: fieldEntitySchema,
  includeArchived: z.boolean().default(false),
});

export const fieldIdSchema = z.object({ id });

const fieldOptionInputSchema = z.object({
  id: id.optional(),
  label: z
    .string()
    .trim()
    .min(1, "An option needs a label.")
    .max(FIELD_OPTION_LABEL_MAX),
});

export type FieldOptionInput = z.infer<typeof fieldOptionInputSchema>;

const label = z
  .string()
  .trim()
  .min(1, "A field needs a label.")
  .max(FIELD_LABEL_MAX);

// Empty means "work from the label and type alone"; the service stores null.
const agentBrief = z.string().trim().max(FIELD_BRIEF_MAX).nullable();

export const createFieldSchema = z.object({
  entity: fieldEntitySchema,
  label,
  type: z.enum(FIELD_TYPES),
  options: z.array(fieldOptionInputSchema).max(FIELD_OPTIONS_MAX).default([]),
  agentFilled: z.boolean().default(true),
  agentBrief: agentBrief.default(null),
  required: z.boolean().default(false),
  showOnSheet: z.boolean().default(true),
  showOnTable: z.boolean().default(false),
  showOnFilter: z.boolean().default(false),
});

export type CreateFieldInput = z.infer<typeof createFieldSchema>;

/** A field's key never changes, so it isn't here. */
export const updateFieldSchema = z.object({
  id,
  label: label.optional(),
  type: z.enum(FIELD_TYPES).optional(),
  options: z.array(fieldOptionInputSchema).max(FIELD_OPTIONS_MAX).optional(),
  agentFilled: z.boolean().optional(),
  agentBrief: agentBrief.optional(),
  required: z.boolean().optional(),
  showOnSheet: z.boolean().optional(),
  showOnTable: z.boolean().optional(),
  showOnFilter: z.boolean().optional(),
});

export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

export const reorderFieldsSchema = z.object({
  entity: fieldEntitySchema,
  ids: z.array(id).min(1).max(500),
});

export const recordFieldsSchema = z.object({
  entity: fieldEntitySchema,
  recordId: id,
});

/** One value as a client sends it; the field's type decides what it means. */
export const fieldValueInputSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const setRecordFieldValuesSchema = recordFieldsSchema.extend({
  values: z
    .record(id, fieldValueInputSchema)
    .refine((values) => Object.keys(values).length > 0, "Name a field to set.")
    .refine(
      (values) => Object.keys(values).length <= 100,
      "Set at most 100 fields at once.",
    ),
});

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-31.");

/**
 * A list filter on one custom field, by what its type can be asked:
 * text-like fields (`contains`, `equals`, case-insensitive), numbers
 * (`range`), dates (`dateRange`, whole days, inclusive), checkboxes
 * (`checked`), and selects and users (`anyOf` option or user ids).
 */
export const fieldFilterSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("contains"),
    value: z.string().trim().min(1).max(200),
  }),
  z.object({
    op: z.literal("equals"),
    value: z.string().trim().min(1).max(200),
  }),
  z
    .object({
      op: z.literal("range"),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .refine((range) => range.min !== undefined || range.max !== undefined),
  z
    .object({
      op: z.literal("dateRange"),
      from: isoDay.optional(),
      to: isoDay.optional(),
    })
    .refine((range) => range.from !== undefined || range.to !== undefined),
  z.object({ op: z.literal("checked"), value: z.boolean() }),
  z.object({
    op: z.literal("anyOf"),
    values: z.array(id).min(1).max(20),
  }),
]);

export type FieldFilter = z.infer<typeof fieldFilterSchema>;

/**
 * Filters by field key. Each one binds a few parameters to the list's query
 * (and `anyOf` one per value); D1 takes about 100 per statement, so a list
 * stays well under that whatever else it filters on.
 */
export const fieldFiltersSchema = z
  .record(id, fieldFilterSchema)
  .refine(
    (filters) =>
      Object.values(filters).reduce(
        (total, filter) =>
          total + 4 + (filter.op === "anyOf" ? filter.values.length : 0),
        0,
      ) <= 64,
    "Too many field filters at once.",
  );

export type FieldFilters = z.infer<typeof fieldFiltersSchema>;
