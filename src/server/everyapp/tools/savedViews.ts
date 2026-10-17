import { z } from "zod";
import { crmTool, memberId } from "@/server/everyapp/crm-tool";
import {
  fieldFiltersInput,
  resolveFieldFilters,
} from "@/server/everyapp/tools/fieldFilters";
import { SavedViewService } from "@/server/features/saved-views/services/SavedViewService";
import { DEAL_STAGES, type FieldEntity } from "@/shared/crm-enums";
import { CLOSING_WINDOWS } from "@/types/schemas/deals";
import { fieldEntitySchema } from "@/types/schemas/fields";
import { SORT_DIRECTIONS, UNASSIGNED } from "@/types/schemas/records";
import {
  createSavedViewSchema,
  savedViewFiltersSchema,
  savedViewIdSchema,
  updateSavedViewSchema,
  type SavedViewFilters,
} from "@/types/schemas/saved-views";

// Saved views: a list's filters under a name, personal until shared. Only a
// view's owner changes or deletes it. A view keeps the filters as the list's
// URL does (owners and user fields by user id, selects by option id); the
// tools take them as the list tools do, by email and label.

const entity = fieldEntitySchema.describe(
  "Which list: COMPANY, CONTACT or DEAL.",
);

const filtersInput = z
  .object({
    query: z.string().max(200).optional(),
    owners: z
      .array(z.string())
      .max(20)
      .optional()
      .describe(`Members' emails, or "${UNASSIGNED}" for records nobody owns.`),
    archived: z.boolean().optional().describe("The archived records instead."),
    fields: fieldFiltersInput,
    sort: z
      .string()
      .max(40)
      .optional()
      .describe("A sort the list tools take for this list."),
    direction: z.enum(SORT_DIRECTIONS).optional(),
    status: z
      .enum(["open", "closed"])
      .optional()
      .describe("Deals only: the pipeline or the outcomes."),
    stages: z.array(z.enum(DEAL_STAGES)).optional().describe("Deals only."),
    closing: z
      .array(z.enum(CLOSING_WINDOWS))
      .optional()
      .describe("Deals only."),
  })
  .strict()
  .describe("The list's filters and sort; anything left out isn't filtered.");

/** The filters as the list's URL keeps them, which is what a view saves. */
async function savedFilters(
  organizationId: string,
  list: FieldEntity,
  input: z.infer<typeof filtersInput>,
): Promise<SavedViewFilters> {
  const owner = input.owners
    ? await Promise.all(
        input.owners.map((value) =>
          value === UNASSIGNED ? UNASSIGNED : memberId(organizationId, value),
        ),
      )
    : undefined;
  const fields = input.fields
    ? await resolveFieldFilters(organizationId, list, input.fields)
    : undefined;
  const filters = {
    q: input.query,
    owner,
    archived: input.archived,
    fields,
    sort: input.sort,
    dir: input.direction,
    status: input.status,
    stage: input.stages,
    closing: input.closing,
  };
  return savedViewFiltersSchema.parse(
    Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined),
    ),
  );
}

export const savedViewTools = {
  list_saved_views: crmTool({
    description:
      "The caller's saved views of the companies, contacts or deals list, and those others share: each one's id, name, whether it is shared or the caller's own, and its filters as the list keeps them.",
    risk: "read",
    input: z.object({ entity }).strict(),
    handler: ({ entity: list }, context) =>
      SavedViewService.list(context.organizationId, context.userId, list),
  }),

  create_saved_view: crmTool({
    description:
      "Save a list's filters as a named view the caller can apply from the list. Personal unless shared with the team. Names are unique per list for each person.",
    risk: "write",
    input: z
      .object({
        entity,
        name: createSavedViewSchema.shape.name,
        shared: z.boolean().optional(),
        filters: filtersInput,
      })
      .strict(),
    handler: async (input, context) =>
      SavedViewService.create(context.organizationId, context.userId, {
        entity: input.entity,
        name: input.name,
        shared: input.shared ?? false,
        filters: await savedFilters(
          context.organizationId,
          input.entity,
          input.filters,
        ),
      }),
  }),

  update_saved_view: crmTool({
    description:
      "Rename, share, unshare or re-filter one of the caller's own views. New filters replace the old ones whole.",
    risk: "write",
    input: z
      .object({
        id: savedViewIdSchema.shape.id.describe(
          "The view's id, from list_saved_views.",
        ),
        entity: entity.describe("The view's list."),
        name: updateSavedViewSchema.shape.name,
        shared: z.boolean().optional(),
        filters: filtersInput.optional(),
      })
      .strict(),
    handler: async (input, context) =>
      SavedViewService.update(context.organizationId, context.userId, {
        id: input.id,
        name: input.name,
        shared: input.shared,
        filters: input.filters
          ? await savedFilters(
              context.organizationId,
              input.entity,
              input.filters,
            )
          : undefined,
      }),
  }),

  delete_saved_view: crmTool({
    description: "Delete one of the caller's own saved views.",
    risk: "destructive",
    input: savedViewIdSchema.strict(),
    handler: ({ id }, context) =>
      SavedViewService.remove(context.organizationId, context.userId, id),
  }),
};
