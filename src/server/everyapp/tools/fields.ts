import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { crmTool } from "@/server/everyapp/crm-tool";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import {
  createFieldSchema,
  fieldEntitySchema,
  fieldIdSchema,
  fieldValueInputSchema,
  updateFieldSchema,
} from "@/types/schemas/fields";

const entityInput = fieldEntitySchema.describe(
  "Which records: COMPANY, CONTACT or DEAL.",
);

const recordIdInput = z
  .string()
  .min(1)
  .max(64)
  .describe("The id of the company, contact or deal.");

export const fieldTools = {
  list_fields: crmTool({
    description:
      "The custom fields the organization added to companies, contacts or deals, in the order records show them: each field's key (what get_field_values and set_field_values take), label, type, a select's options (id and label), and its brief, which says what counts as an answer. Archived fields are left out unless asked for.",
    risk: "read",
    input: z
      .object({
        entity: entityInput,
        includeArchived: z
          .boolean()
          .optional()
          .describe("Also list archived fields, which records hide."),
      })
      .strict(),
    handler: ({ entity, includeArchived }, context) =>
      FieldsService.list(context.organizationId, entity, { includeArchived }),
  }),

  get_field_values: crmTool({
    description:
      "One company's, contact's or deal's custom fields, each with its value (null when empty). A select's value is its option's id; the field lists its options.",
    risk: "read",
    input: z.object({ entity: entityInput, recordId: recordIdInput }).strict(),
    handler: ({ entity, recordId }, context) =>
      FieldValuesService.recordFields(context.organizationId, entity, recordId),
  }),

  set_field_values: crmTool({
    description:
      "Set custom field values on one company, contact or deal, by field key (call list_fields for the keys). A select takes an option's id or label, a date YYYY-MM-DD, a checkbox true or false, a user field the user id of someone in the organization, and null clears a value. Every value is checked before any is written. Returns the record's fields.",
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
    handler: async ({ entity, recordId, values }, context) => {
      await FieldValuesService.setValues(
        context.organizationId,
        entity,
        recordId,
        values,
      );
      return FieldValuesService.recordFields(
        context.organizationId,
        entity,
        recordId,
      );
    },
  }),

  create_field: crmTool({
    description:
      "Add a custom field to every company, contact or deal (owners and admins only). Its key is made from the label and never changes. A select needs its options. By default the research agent fills it (agentFilled), working from the label, the type and the brief; it is queued for existing records at once.",
    risk: "write",
    input: createFieldSchema.strict(),
    handler: (input, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.create(context.organizationId, input);
    },
  }),

  update_field: crmTool({
    description:
      "Change a custom field's label, brief, options or placement (owners and admins only). The key never changes, and the type only while the field holds no values. Passing options replaces the select's list: keep an option by sending its id, and an option left out is retired (values that use it keep it).",
    risk: "write",
    input: updateFieldSchema.strict(),
    handler: (input, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.update(context.organizationId, input);
    },
  }),

  archive_field: crmTool({
    description:
      "Archive a custom field (owners and admins only): it disappears from every record, table and filter, and its values are kept.",
    risk: "destructive",
    input: fieldIdSchema.strict(),
    handler: ({ id }, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.archive(context.organizationId, id);
    },
  }),

  fill_field: crmTool({
    description:
      "Ask the research agent to fill a custom field on the records that have no value yet, up to 500 at a time (owners and admins only, and only for fields the agent fills). Returns how many records were queued, and how many already-queued ones had this field added.",
    risk: "write",
    input: fieldIdSchema.strict(),
    handler: ({ id }, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.fill(context.organizationId, id);
    },
  }),
};
