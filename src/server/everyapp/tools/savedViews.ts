import { keys } from "remeda";
import { z } from "zod";
import { crmTool, memberId, ownersInput } from "@/server/everyapp/crm-tool";
import {
  fieldFiltersInput,
  resolveFieldFilters,
} from "@/server/everyapp/tools/fieldFilters";
import { SavedViewService } from "@/server/features/saved-views/services/SavedViewService";
import { AppError } from "@/server/lib/errors";
import {
  DEAL_STAGES,
  FIELD_ENTITIES,
  type FieldEntity,
} from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import { COMPANY_SORTS } from "@/types/schemas/companies";
import { CONTACT_SORTS, NO_COMPANY } from "@/types/schemas/contacts";
import { CLOSING_WINDOWS, DEAL_SORTS } from "@/types/schemas/deals";
import { fieldEntitySchema } from "@/types/schemas/fields";
import {
  SORT_DIRECTIONS,
  UNASSIGNED,
  facetFilterSchema,
} from "@/types/schemas/records";
import {
  createSavedViewSchema,
  savedViewFiltersSchema,
  savedViewIdSchema,
  updateSavedViewSchema,
  type SavedViewFilters,
} from "@/types/schemas/saved-views";

// Saved views: a list's filters under a name, personal until shared. Only a
// view's owner changes or deletes it. A view keeps the filters as the list's
// URL does (owners and user fields by user id, selects by option id), which
// the list tools take as they are; these tools take them as the list tools
// do, by email or id and by label.

const entity = fieldEntitySchema.describe(
  "Which list: COMPANY, CONTACT or DEAL.",
);

const values = facetFilterSchema.unwrap().optional();

const filtersInput = z
  .object({
    query: z.string().max(200).optional(),
    owners: ownersInput.describe(
      `Members' emails or ids, or "${UNASSIGNED}" for records nobody owns.`,
    ),
    archived: z.boolean().optional().describe("The archived records instead."),
    fields: fieldFiltersInput,
    sort: z
      .string()
      .max(40)
      .optional()
      .describe("A sort the list tools take for this list."),
    direction: z.enum(SORT_DIRECTIONS).optional(),
    industries: values.describe("Companies only."),
    companyIds: values.describe(
      `Contacts only: company ids, "${NO_COMPANY}" for contacts at none.`,
    ),
    titles: values.describe("Contacts only."),
    seniorities: values.describe("Contacts only."),
    personas: values.describe("Contacts only: functions."),
    activeWithinDays: z
      .literal([7, 30, 90])
      .optional()
      .describe("Companies and contacts only."),
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

type FiltersInput = z.infer<typeof filtersInput>;

/** The filters only some lists have, and those lists. */
const LIST_FILTERS = {
  industries: ["COMPANY"],
  companyIds: ["CONTACT"],
  titles: ["CONTACT"],
  seniorities: ["CONTACT"],
  personas: ["CONTACT"],
  activeWithinDays: ["COMPANY", "CONTACT"],
  status: ["DEAL"],
  stages: ["DEAL"],
  closing: ["DEAL"],
} as const satisfies Partial<
  Record<keyof FiltersInput, readonly FieldEntity[]>
>;

const SORTS: Record<FieldEntity, readonly string[]> = {
  COMPANY: COMPANY_SORTS,
  CONTACT: CONTACT_SORTS,
  DEAL: DEAL_SORTS,
};

const viewOutput = z.object({
  id: z.string(),
  entity: z.enum(FIELD_ENTITIES),
  name: z.string(),
  shared: z.boolean(),
  mine: z.boolean().describe("The caller's own, theirs to change."),
  filters: z
    .record(z.string(), z.unknown())
    .describe(
      "As the list's URL keeps them: owners and user fields by user id, selects by option id, which the list tools take as they are.",
    ),
  updatedAt: z.string(),
});

/**
 * The filters as the list's URL keeps them, which is what a view saves. A
 * filter or sort the list doesn't have is refused: the list would drop it.
 */
async function savedFilters(
  organizationId: string,
  list: FieldEntity,
  input: FiltersInput,
): Promise<SavedViewFilters> {
  const nouns = ENTITY_NOUNS[list].many;
  for (const key of keys(LIST_FILTERS)) {
    const lists: readonly FieldEntity[] = LIST_FILTERS[key];
    if (input[key] !== undefined && !lists.includes(list)) {
      throw new AppError("VALIDATION_ERROR", `${key} doesn't filter ${nouns}.`);
    }
  }
  if (input.sort !== undefined && !SORTS[list].includes(input.sort)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `The ${nouns} list sorts by ${SORTS[list].join(", ")}.`,
    );
  }
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
    industry: input.industries,
    company: input.companyIds,
    title: input.titles,
    seniority: input.seniorities,
    persona: input.personas,
    activity: input.activeWithinDays,
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
      "The caller's saved views of the companies, contacts or deals list and the ones others share, with their filters.",
    risk: "read",
    input: z.object({ entity }).strict(),
    output: z.object({ views: z.array(viewOutput) }),
    handler: async ({ entity: list }, context) => ({
      views: await SavedViewService.list(
        context.organizationId,
        context.userId,
        list,
      ),
    }),
  }),

  create_saved_view: crmTool({
    description:
      "Save a list's filters as a named view, personal unless shared with the team. Names are unique per list for each person.",
    risk: "write",
    input: z
      .object({
        entity,
        name: createSavedViewSchema.shape.name,
        shared: z.boolean().optional(),
        filters: filtersInput,
      })
      .strict(),
    output: viewOutput,
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
    output: viewOutput,
    handler: async (input, context) => {
      const view = await SavedViewService.getOwned(
        context.organizationId,
        context.userId,
        input.id,
      );
      if (view.entity !== input.entity) {
        throw new AppError(
          "VALIDATION_ERROR",
          `That view is of ${ENTITY_NOUNS[view.entity].many}, not ${ENTITY_NOUNS[input.entity].many}.`,
        );
      }
      return SavedViewService.update(context.organizationId, context.userId, {
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
      });
    },
  }),

  delete_saved_view: crmTool({
    description: "Delete one of the caller's own saved views.",
    risk: "destructive",
    input: savedViewIdSchema.strict(),
    output: z.object({ id: z.string() }),
    handler: ({ id }, context) =>
      SavedViewService.remove(context.organizationId, context.userId, id),
  }),
};
