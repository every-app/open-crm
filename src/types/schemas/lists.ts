import { z } from "zod";
import { LIST_ENTITIES, STAGE_KINDS, type StageKind } from "@/shared/crm-enums";

// Lists: a context the team works people or companies in, with its own
// stages or none (docs/design/contact-lists.md).

export const LIST_NAME_MAX = 80;
const LIST_DESCRIPTION_MAX = 500;
export const STAGE_NAME_MAX = 60;
/** The most stages one list has: enough for any pipeline, few enough for a board. */
export const LIST_STAGES_MAX = 12;
/** The most records one add, remove or stage change names by id. */
export const LIST_IDS_MAX = 100;
/** The most records one "add all matching" puts in a list. */
export const LIST_MATCHING_MAX = 5_000;
/** The most entries a board shows. */
export const LIST_ENTRIES_MAX = 500;
/** A stage change's note, kept on the timeline. */
const STAGE_NOTE_MAX = 2_000;

/** The colors a list can take, as the sidebar and chips draw them. */
export const LIST_COLORS = [
  "gray",
  "blue",
  "green",
  "amber",
  "red",
  "purple",
  "pink",
  "teal",
] as const;
export type ListColor = (typeof LIST_COLORS)[number];

type StageTemplate = { name: string; kind: StageKind };

/** The stages a new list starts with. Plain is a group, like a tag. */
export const LIST_TEMPLATES = {
  OUTREACH: [
    { name: "To contact", kind: "OPEN" },
    { name: "Contacted", kind: "OPEN" },
    { name: "Replied", kind: "OPEN" },
    { name: "Done", kind: "DONE" },
    { name: "Not interested", kind: "DROPPED" },
  ],
  NETWORKING: [
    { name: "To meet", kind: "OPEN" },
    { name: "Met", kind: "OPEN" },
    { name: "Keep in touch", kind: "OPEN" },
    { name: "Dormant", kind: "DROPPED" },
  ],
  PLAIN: [],
} satisfies Record<string, StageTemplate[]>;
export type ListTemplate = keyof typeof LIST_TEMPLATES;

const id = z.string().min(1).max(64);

const name = z
  .string()
  .trim()
  .min(1, "A list needs a name.")
  .max(LIST_NAME_MAX);

const description = z.string().trim().max(LIST_DESCRIPTION_MAX).nullable();

/** Days quiet before an entry at an open stage is Due; null turns it off. */
const followUpDays = z.number().int().min(1).max(365).nullable();

const stageInput = z.object({
  /** An existing stage's id, to rename or reorder it; left out for a new one. */
  id: id.optional(),
  name: z.string().trim().min(1, "A stage needs a name.").max(STAGE_NAME_MAX),
  kind: z.enum(STAGE_KINDS).default("OPEN"),
});

const listEntitySchema = z.enum(LIST_ENTITIES);

export const listListsSchema = z.object({
  includeArchived: z.boolean().default(false),
});

export const listIdSchema = z.object({ id });

export const createListSchema = z.object({
  entity: listEntitySchema,
  name,
  color: z.enum(LIST_COLORS).default("blue"),
  description: description.optional(),
  followUpDays: followUpDays.optional(),
  /** The stages it starts with, unless `stages` names them. */
  template: z.enum(["OUTREACH", "NETWORKING", "PLAIN"]).default("PLAIN"),
  stages: z
    .array(stageInput.omit({ id: true }))
    .max(LIST_STAGES_MAX)
    .optional(),
});
export type CreateListInput = z.infer<typeof createListSchema>;

export const updateListSchema = z.object({
  id,
  name: name.optional(),
  color: z.enum(LIST_COLORS).optional(),
  description: description.optional(),
  followUpDays: followUpDays.optional(),
  /** True archives it (hidden, entries kept), false brings it back. */
  archived: z.boolean().optional(),
});

/**
 * A list's stages, all of them, in order: an existing one by id is renamed
 * or moved, one without an id is added, and one left out is removed (only
 * when nobody is at it).
 */
export const setListStagesSchema = z.object({
  listId: id,
  stages: z.array(stageInput).max(LIST_STAGES_MAX),
});
export type SetListStagesInput = z.infer<typeof setListStagesSchema>;

/**
 * A list's details and, when given, all its stages (as setListStagesSchema
 * takes them), saved together: a refusal of either changes neither.
 */
export const saveListSchema = updateListSchema.extend({
  stages: setListStagesSchema.shape.stages.optional(),
});
export type SaveListInput = z.infer<typeof saveListSchema>;

const stageId = id.nullable();

export const addToListSchema = z.object({
  listId: id,
  /** Contact or company ids, as the list holds. */
  ids: z.array(id).min(1).max(LIST_IDS_MAX),
  /** The stage they start at; left out, the list's first stage. Null: none. */
  stageId: stageId.optional(),
});
export type AddToListInput = z.infer<typeof addToListSchema>;

export const addMatchingToListSchema = z.object({
  listId: id,
  /**
   * The contacts or companies list's filters (its list input), as the list
   * holds: everyone they match, up to LIST_MATCHING_MAX, goes in.
   */
  filters: z.record(z.string(), z.unknown()),
  stageId: stageId.optional(),
});
export type AddMatchingToListInput = z.infer<typeof addMatchingToListSchema>;

export const removeFromListSchema = z.object({
  listId: id,
  ids: z.array(id).min(1).max(LIST_IDS_MAX),
});
export type RemoveFromListInput = z.infer<typeof removeFromListSchema>;

export const setListStageSchema = z.object({
  listId: id,
  /** Contact or company ids, as the list holds. */
  ids: z.array(id).min(1).max(LIST_IDS_MAX),
  /** The stage to move them to; null takes them off every stage. */
  stageId,
  /** Why, or what happened: kept with the move on their timeline. */
  note: z.string().trim().max(STAGE_NOTE_MAX).optional(),
});
export type SetListStageInput = z.infer<typeof setListStageSchema>;

export const listEntriesSchema = z.object({
  listId: id,
  /** Stage ids, and NO_STAGE for entries at none. */
  stage: z
    .array(id)
    .max(LIST_STAGES_MAX + 1)
    .default([]),
  due: z.boolean().default(false),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_ENTRIES_MAX)
    .default(LIST_ENTRIES_MAX),
});
export type ListEntriesInput = z.infer<typeof listEntriesSchema>;

export const recordListsSchema = z.object({
  entity: listEntitySchema,
  id,
});
