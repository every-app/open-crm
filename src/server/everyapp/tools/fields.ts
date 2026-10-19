import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool } from "@/server/everyapp/crm-tool";
import {
  fieldValueOutput,
  userFieldsByEmail,
  withMemberIds,
} from "@/server/everyapp/tools/fieldFilters";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  type FieldEntity,
} from "@/shared/crm-enums";
import {
  createFieldSchema,
  fieldEntitySchema,
  fieldIdSchema,
  fieldValueInputSchema,
  reorderFieldsSchema,
  updateFieldSchema,
} from "@/types/schemas/fields";

// Custom fields: everyone reads them and sets their values on records;
// owners and admins add, change, reorder, archive and delete them and ask the
// research agent to fill them, as in the app.

const entityInput = fieldEntitySchema.describe(
  "Which records: COMPANY, CONTACT or DEAL.",
);

const recordIdInput = z
  .string()
  .min(1)
  .max(64)
  .describe("The id of the company, contact or deal.");

const fieldIdInput = fieldIdSchema
  .extend({
    id: fieldIdSchema.shape.id.describe("The field's id, from list_fields."),
  })
  .strict();

const fieldOutput = z.object({
  id: z.string(),
  entity: z.enum(FIELD_ENTITIES),
  key: z.string().describe("What set_field_values and the filters take."),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  options: z
    .array(z.object({ id: z.string(), label: z.string() }))
    .describe("A select's options."),
  agentFilled: z.boolean().describe("The research agent fills it."),
  agentBrief: z
    .string()
    .nullable()
    .describe("What counts as an answer, for the agent."),
  required: z.boolean(),
  showOnSheet: z.boolean().describe("A record's details show it."),
  showOnTable: z.boolean().describe("The list tools return its values."),
  showOnFilter: z.boolean().describe("The list's Filters menu offers it."),
  archived: z.boolean(),
});

const recordFieldsOutput = z.object({
  fields: z.array(
    fieldOutput.extend({
      value: fieldValueOutput.describe(
        "A select's is its option's id; a user field's the member's email.",
      ),
    }),
  ),
});

/** A record's fields, user fields' values by email. */
async function recordFields(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
) {
  const [fields, shown] = await Promise.all([
    FieldValuesService.recordFields(organizationId, entity, recordId),
    userFieldsByEmail(organizationId, entity),
  ]);
  return {
    fields: fields.map((field) => ({
      ...field,
      value: shown(field.key, field.value),
    })),
  };
}

const manage = { field: ["manage" as const] };

export const fieldTools = {
  list_fields: crmTool({
    description:
      "The custom fields on companies, contacts or deals, in the order records show them: each one's key, label, type, a select's options and the brief the research agent fills it from. Archived fields only when asked.",
    risk: "read",
    input: z
      .object({
        entity: entityInput,
        includeArchived: z
          .boolean()
          .optional()
          .describe("Also list archived fields."),
      })
      .strict(),
    output: z.object({ fields: z.array(fieldOutput) }),
    handler: async ({ entity, includeArchived }, context) => ({
      fields: await FieldsService.list(context.organizationId, entity, {
        includeArchived,
      }),
    }),
  }),

  get_field_values: crmTool({
    description:
      "One company's, contact's or deal's custom fields, each with its value (null when empty).",
    risk: "read",
    input: z.object({ entity: entityInput, recordId: recordIdInput }).strict(),
    output: recordFieldsOutput,
    handler: ({ entity, recordId }, context) =>
      recordFields(context.organizationId, entity, recordId),
  }),

  set_field_values: crmTool({
    description:
      "Set custom field values on one company, contact or deal, by field key (list_fields). A select takes an option's id or label, a date YYYY-MM-DD, a checkbox true or false, a user field a member's email; null clears. Every value is checked before any is written.",
    risk: "write",
    input: z
      .object({
        entity: entityInput,
        recordId: recordIdInput,
        values: z
          .record(z.string(), fieldValueInputSchema)
          .describe('Values by field key, e.g. { "segment": "Enterprise" }.'),
      })
      .strict(),
    output: recordFieldsOutput,
    handler: async ({ entity, recordId, values }, context) => {
      await FieldValuesService.setValues(
        context.organizationId,
        entity,
        recordId,
        await withMemberIds(context.organizationId, entity, values),
      );
      return recordFields(context.organizationId, entity, recordId);
    },
  }),

  create_field: crmTool({
    description:
      "Add a custom field to every company, contact or deal (owners and admins only). Its key comes from the label and never changes. A select needs options. The research agent fills it from the label, type and brief unless agentFilled is false, starting with the existing records.",
    risk: "write",
    input: createFieldSchema.strict(),
    output: fieldOutput,
    handler: async (input, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.create(context.organizationId, input);
    },
  }),

  update_field: crmTool({
    description:
      "Change a custom field's label, brief, options or placement (owners and admins only). The key never changes, the type only while it holds no values. Options replace the list, in the order given: keep one by sending its id; one left out is retired, and records keep it.",
    risk: "write",
    input: updateFieldSchema.strict(),
    output: fieldOutput,
    handler: async (input, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.update(context.organizationId, input);
    },
  }),

  reorder_fields: crmTool({
    description:
      "Put the custom fields of companies, contacts or deals in a new order, the order records show them in (owners and admins only). Name every live field once. A select's options are reordered with update_field.",
    risk: "write",
    input: reorderFieldsSchema
      .extend({
        entity: entityInput,
        ids: reorderFieldsSchema.shape.ids.describe(
          "Every live field's id, from list_fields, in the new order.",
        ),
      })
      .strict(),
    output: z.object({ fields: z.array(fieldOutput) }),
    handler: async ({ entity, ids }, context) => {
      requireOrgPermission(context, manage);
      return {
        fields: await FieldsService.reorder(
          context.organizationId,
          entity,
          ids,
        ),
      };
    },
  }),

  archive_field: crmTool({
    description:
      "Archive a custom field (owners and admins only): records, tables and filters stop showing it and its values are kept. restore_field brings it back.",
    risk: "write",
    input: fieldIdInput,
    output: fieldOutput,
    handler: async ({ id }, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.archive(context.organizationId, id);
    },
  }),

  restore_field: crmTool({
    description:
      "Restore an archived custom field with its values (owners and admins only).",
    risk: "write",
    input: fieldIdInput,
    output: fieldOutput,
    handler: async ({ id }, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.restore(context.organizationId, id);
    },
  }),

  delete_field: crmTool({
    description:
      "Delete a custom field and every value it holds, for good (owners and admins only). archive_field keeps the values.",
    risk: "destructive",
    input: fieldIdInput,
    output: z.object({ id: z.string() }),
    handler: async ({ id }, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.remove(context.organizationId, id);
    },
  }),

  get_field_coverage: crmTool({
    description:
      "How many live records have a value for a custom field, of how many: what fill_field would have left to do.",
    risk: "read",
    input: fieldIdInput,
    output: z.object({
      filled: z.number().describe("Live records with a value."),
      total: z.number().describe("Live records."),
    }),
    handler: ({ id }, context) =>
      FieldsService.coverage(context.organizationId, id),
  }),

  fill_field: crmTool({
    description:
      "Ask the research agent to fill a custom field on records with no value yet, up to 500 at a time (owners and admins only, fields the agent fills).",
    risk: "write",
    input: fieldIdInput,
    output: z.object({
      queued: z.number().describe("Records newly queued."),
      merged: z
        .number()
        .describe("Records already queued that had the field added."),
    }),
    handler: async ({ id }, context) => {
      requireOrgPermission(context, manage);
      return FieldsService.fill(context.organizationId, id);
    },
  }),
};
