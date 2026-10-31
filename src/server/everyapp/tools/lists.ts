import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool } from "@/server/everyapp/crm-tool";
import {
  companyFiltersInput,
  companyListFilters,
} from "@/server/everyapp/tools/companies";
import {
  contactFiltersInput,
  contactListFilters,
} from "@/server/everyapp/tools/contacts";
import {
  listOf,
  listStagesInput,
  recordIds,
  recordsInput,
  stageFilter,
  stageId,
  unmatchedOutput,
} from "@/server/everyapp/tools/listFilters";
import { ListService } from "@/server/features/lists/services/ListService";
import { AppError } from "@/server/lib/errors";
import { LIST_ENTITIES, STAGE_KINDS } from "@/shared/crm-enums";
import {
  LIST_COLORS,
  LIST_ENTRIES_MAX,
  LIST_MATCHING_MAX,
  LIST_TEMPLATES,
  createListSchema,
  setListStageSchema,
  setListStagesSchema,
  updateListSchema,
} from "@/types/schemas/lists";
import { NO_STAGE } from "@/types/schemas/records";

// Lists: a context the team works contacts or companies in ("Backlink
// outreach", "Networking"), with its own stages or none, as an AI client
// sees them (docs/design/contact-lists.md). Records go in by id, contacts by
// email and companies by domain (listFilters.ts). Members make and work
// lists; deleting one is for owners and admins.

const listId = z
  .string()
  .min(1)
  .max(64)
  .describe("The list's id, from list_lists.");

const stageOutput = z.object({
  id: z.string(),
  name: z.string(),
  kind: z
    .enum(STAGE_KINDS)
    .describe("OPEN (being worked), DONE or DROPPED (finished)."),
  count: z.number().describe("Live records at it."),
});

const listOutput = z.object({
  id: z.string(),
  entity: z.enum(LIST_ENTITIES).describe("What it holds."),
  name: z.string(),
  color: z.enum(LIST_COLORS),
  description: z.string().nullable(),
  followUpDays: z
    .number()
    .nullable()
    .describe(
      "Days quiet before a record at an open stage is Due; null: never.",
    ),
  archived: z.boolean(),
  stages: z.array(stageOutput).describe("In order; none for a plain list."),
  total: z.number().describe("Live records in it."),
  noStage: z.number().describe("Of those, at no stage."),
  due: z.number().describe("Of those, Due."),
  createdAt: z.string(),
});

const stageInput = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("A stage of the list, by id or name (any case).");

export const listTools = {
  list_lists: crmTool({
    description:
      "The lists people or companies are worked in (outreach, networking, a group), each with what it holds, its stages and how many are at each, how many are at no stage, and how many are Due (quiet past its follow-up days at an open stage). Use it for a list's id and stages before the other list tools.",
    risk: "read",
    input: z
      .object({
        entity: z
          .enum(LIST_ENTITIES)
          .optional()
          .describe("Only lists of contacts, or of companies."),
        includeArchived: z.boolean().optional().describe("Archived lists too."),
      })
      .strict(),
    output: z.object({ lists: z.array(listOutput) }),
    handler: async (input, context) => {
      const lists = await ListService.listLists(context.organizationId, {
        includeArchived: input.includeArchived ?? false,
      });
      return {
        lists: lists.filter(
          (list) => !input.entity || list.entity === input.entity,
        ),
      };
    },
  }),

  list_list_entries: crmTool({
    description: `Who is in a list, as its board shows them: each record's name and title or domain, stage, whether it is Due, last activity and when it reached its stage, most recently moved first. Filter by stage and to the Due ones ("who should I follow up with"). Up to ${LIST_ENTRIES_MAX}.`,
    risk: "read",
    input: z
      .object({
        listId,
        stages: listStagesInput.describe(
          `Only those at these stages, by id or name; "${NO_STAGE}" for those at no stage.`,
        ),
        due: z.boolean().optional().describe("Only the Due ones."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_ENTRIES_MAX)
          .optional()
          .describe(`At most this many: 100 unless said.`),
      })
      .strict(),
    output: z.object({
      list: z.object({
        id: z.string(),
        name: z.string(),
        entity: z.enum(LIST_ENTITIES),
      }),
      total: z.number().describe("How many match, beyond the limit too."),
      entries: z.array(
        z.object({
          recordId: z.string().describe("The contact's or company's id."),
          name: z.string(),
          detail: z
            .string()
            .nullable()
            .describe("A contact's title, a company's domain."),
          stage: z.object({ id: z.string(), name: z.string() }).nullable(),
          due: z.boolean(),
          lastActivityAt: z.string().nullable(),
          stageChangedAt: z.string(),
          addedAt: z.string(),
        }),
      ),
    }),
    handler: async (input, context) => {
      const list = await listOf(context.organizationId, input.listId);
      const { entries, total } = await ListService.listEntries(
        context.organizationId,
        {
          listId: list.id,
          stage: stageFilter(list, input.stages ?? []),
          due: input.due ?? false,
          limit: input.limit ?? 100,
        },
      );
      const stages = new Map(list.stages.map((stage) => [stage.id, stage]));
      return {
        list,
        total,
        entries: entries.map((entry) => ({
          ...entry,
          stage: (entry.stageId && stages.get(entry.stageId)) || null,
        })),
      };
    },
  }),

  create_list: crmTool({
    description: `Make a list to work contacts or companies in. Its stages come from a template unless given: OUTREACH (${LIST_TEMPLATES.OUTREACH.map((stage) => stage.name).join(", ")}), NETWORKING (${LIST_TEMPLATES.NETWORKING.map((stage) => stage.name).join(", ")}) or PLAIN (no stages: a group, like a tag). A list's name is unique.`,
    risk: "write",
    input: createListSchema
      .extend({
        color: createListSchema.shape.color.describe("blue unless said."),
        followUpDays: createListSchema.shape.followUpDays.describe(
          "Days quiet before a record at an open stage is Due, 1 to 365; null or left out: never.",
        ),
        template: createListSchema.shape.template.describe(
          "The stages it starts with, unless stages names them: PLAIN unless said.",
        ),
        stages: createListSchema.shape.stages.describe(
          "Its stages in order, instead of a template's. kind: OPEN (being worked, the default), DONE or DROPPED.",
        ),
      })
      .strict(),
    output: listOutput,
    handler: (input, context) =>
      ListService.createList(context.organizationId, context.userId, input),
  }),

  update_list: crmTool({
    description:
      "Rename, recolor or describe a list, change its follow-up days, or archive it (hidden, everyone in it kept) or restore it. Only what is given changes. set_list_stages changes its stages.",
    risk: "write",
    input: updateListSchema
      .extend({
        id: listId,
        followUpDays: updateListSchema.shape.followUpDays.describe(
          "Days quiet before a record at an open stage is Due, 1 to 365; null: never.",
        ),
        archived: updateListSchema.shape.archived.describe(
          "True archives it, false restores it.",
        ),
      })
      .strict(),
    output: listOutput,
    handler: (input, context) =>
      ListService.updateList(context.organizationId, input),
  }),

  set_list_stages: crmTool({
    description:
      "Write a list's stages, all of them, in order: a stage given with its id is kept (renamed or moved), one without an id is added, and one left out is removed, which is refused while anyone is at it (set_list_stage them elsewhere first). An empty list of stages makes it a plain group.",
    risk: "write",
    input: setListStagesSchema
      .extend({
        listId,
        stages: setListStagesSchema.shape.stages.describe(
          "Every stage, in order: { id?, name, kind? }. kind: OPEN (the default), DONE or DROPPED.",
        ),
      })
      .strict(),
    output: listOutput,
    handler: (input, context) =>
      ListService.setStages(context.organizationId, input),
  }),

  delete_list: crmTool({
    description:
      "Delete a list for good, with its stages and who was in it (owners and admins only). The contacts and companies stay; the stage moves on their timelines stay. update_list archives one instead.",
    risk: "destructive",
    input: z.object({ id: listId }).strict(),
    output: z.object({ id: z.string() }),
    handler: (input, context) => {
      requireOrgPermission(context, { record: ["purge"] });
      return ListService.deleteList(context.organizationId, input.id);
    },
  }),

  add_to_list: crmTool({
    description: `Put contacts or companies in a list: by id, contacts by email, companies by domain, or everyone matchingContacts or matchingCompanies finds (list_contacts' or list_companies' filters, up to ${LIST_MATCHING_MAX.toLocaleString("en-US")}). They start at stage, or the list's first stage if left out. Says how many went in, were in already, and were not found.`,
    risk: "write",
    input: z
      .object({
        listId,
        ...recordsInput,
        matchingContacts: contactFiltersInput
          .strict()
          .optional()
          .describe(
            "Everyone list_contacts finds with these filters, for a list of contacts.",
          ),
        matchingCompanies: companyFiltersInput
          .strict()
          .optional()
          .describe(
            "Every company list_companies finds with these filters, for a list of companies.",
          ),
        stage: stageInput
          .nullable()
          .optional()
          .describe(
            "The stage they start at, by id or name; null for none; the list's first stage if left out.",
          ),
      })
      .strict(),
    output: z.object({
      added: z.number(),
      alreadyIn: z.number(),
      notFound: z
        .number()
        .describe("Ids, emails or domains no live record has."),
      unmatched: unmatchedOutput,
      matched: z
        .number()
        .nullable()
        .describe("How many the filters found, when given."),
    }),
    handler: async (input, context) => {
      const { organizationId, userId } = context;
      const list = await listOf(organizationId, input.listId);
      const stage =
        input.stage === undefined || input.stage === null
          ? input.stage
          : stageId(list, input.stage);
      const { matchingContacts, matchingCompanies } = input;
      if (matchingContacts || matchingCompanies) {
        if (input.ids || input.emails || input.domains) {
          throw new AppError(
            "VALIDATION_ERROR",
            "Name records by ids, emails or domains, or by filters, not both.",
          );
        }
        const contacts = list.entity === "CONTACT";
        const filters = contacts
          ? matchingContacts &&
            (await contactListFilters(organizationId, matchingContacts))
          : matchingCompanies &&
            (await companyListFilters(organizationId, matchingCompanies));
        if (!filters || (contacts ? matchingCompanies : matchingContacts)) {
          throw new AppError(
            "VALIDATION_ERROR",
            `${list.name} holds ${contacts ? "contacts: give matchingContacts" : "companies: give matchingCompanies"} only.`,
          );
        }
        const result = await ListService.addMatchingToList(
          organizationId,
          userId,
          { listId: list.id, filters, stageId: stage },
        );
        return { ...result, unmatched: [] };
      }
      const { ids, unmatched } = await recordIds(organizationId, list, input);
      const result =
        ids.length > 0
          ? await ListService.addToList(organizationId, userId, {
              listId: list.id,
              ids,
              stageId: stage,
            })
          : { added: 0, alreadyIn: 0, notFound: 0 };
      return {
        ...result,
        notFound: result.notFound + unmatched.length,
        unmatched,
        matched: null,
      };
    },
  }),

  remove_from_list: crmTool({
    description:
      "Take contacts or companies out of a list, by id, contacts by email, companies by domain. The records stay in the CRM, and their stage moves stay on their timelines.",
    risk: "write",
    input: z.object({ listId, ...recordsInput }).strict(),
    output: z.object({
      removed: z.number(),
      notInList: z.number(),
      unmatched: unmatchedOutput,
    }),
    handler: async (input, context) => {
      const list = await listOf(context.organizationId, input.listId);
      const { ids, unmatched } = await recordIds(
        context.organizationId,
        list,
        input,
      );
      const result =
        ids.length > 0
          ? await ListService.removeFromList(context.organizationId, {
              listId: list.id,
              ids,
            })
          : { removed: 0, notInList: 0 };
      return { ...result, unmatched };
    },
  }),

  set_list_stage: crmTool({
    description:
      'Move contacts or companies in a list to one of its stages, or to none, by id, contacts by email, companies by domain. Give a note with what happened or why ("replied, wants a call in May"): it goes on each one\'s timeline with the move. They must be in the list already (add_to_list).',
    risk: "write",
    input: z
      .object({
        listId,
        ...recordsInput,
        stage: stageInput
          .nullable()
          .describe(
            "The stage, by id or name; null takes them off every stage.",
          ),
        note: setListStageSchema.shape.note.describe(
          "What happened or why, kept with the move on their timeline.",
        ),
      })
      .strict(),
    output: z.object({
      moved: z.number(),
      unchanged: z.number().describe("Already at that stage."),
      notInList: z.number().describe("Not in the list: add_to_list first."),
      unmatched: unmatchedOutput,
    }),
    handler: async (input, context) => {
      const list = await listOf(context.organizationId, input.listId);
      const to = input.stage === null ? null : stageId(list, input.stage);
      const { ids, unmatched } = await recordIds(
        context.organizationId,
        list,
        input,
      );
      const result =
        ids.length > 0
          ? await ListService.setStage(context.organizationId, context.userId, {
              listId: list.id,
              ids,
              stageId: to,
              note: input.note,
            })
          : { moved: 0, unchanged: 0, notInList: 0 };
      return { ...result, unmatched };
    },
  }),
};
