import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { apiRoute } from "@/server/api/apiRoute";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  createFieldSchema,
  fieldIdSchema,
  listFieldsSchema,
  reorderFieldsSchema,
  setRecordFieldValuesSchema,
  updateFieldSchema,
} from "@/types/schemas/fields";

// As in src/serverFunctions/fields.ts: everyone reads the fields and edits the
// values on records; owners and admins add, change, reorder, archive and
// delete fields and ask the agent to fill them.

const tag = "Custom fields";

const definitionRoutes = [
  apiRoute({
    method: "GET",
    path: "/fields",
    tag,
    summary:
      "The custom fields on companies, contacts or deals, in the order records show them.",
    input: listFieldsSchema,
    handler: (data, context) =>
      FieldsService.list(context.organizationId, data.entity, {
        includeArchived: data.includeArchived,
      }),
  }),
  apiRoute({
    method: "POST",
    path: "/fields",
    tag,
    summary:
      "Add a custom field (owners and admins). Its key is made from the label and never changes.",
    input: createFieldSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.create(context.organizationId, data);
    },
  }),
  apiRoute({
    method: "PATCH",
    path: "/fields/{id}",
    tag,
    summary:
      "Change a custom field (owners and admins). Options replace the select's list: keep one by sending its id.",
    input: updateFieldSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.update(context.organizationId, data);
    },
  }),
  apiRoute({
    method: "POST",
    path: "/fields/reorder",
    tag,
    summary: "Put an entity's fields in this order (owners and admins).",
    input: reorderFieldsSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.reorder(
        context.organizationId,
        data.entity,
        data.ids,
      );
    },
  }),
  apiRoute({
    method: "POST",
    path: "/fields/{id}/archive",
    tag,
    summary:
      "Archive a custom field (owners and admins): records hide it and keep its values.",
    input: fieldIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.archive(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "POST",
    path: "/fields/{id}/restore",
    tag,
    summary: "Restore an archived custom field (owners and admins).",
    input: fieldIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.restore(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "DELETE",
    path: "/fields/{id}",
    tag,
    summary:
      "Delete a custom field and every value it holds (owners and admins).",
    input: fieldIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.remove(context.organizationId, data.id);
    },
  }),
  apiRoute({
    method: "GET",
    path: "/fields/{id}/coverage",
    tag,
    summary: "How many live records have a value for the field.",
    input: fieldIdSchema,
    handler: (data, context) =>
      FieldsService.coverage(context.organizationId, data.id),
  }),
  apiRoute({
    method: "POST",
    path: "/fields/{id}/backfill",
    tag,
    summary:
      "Ask the research agent to fill the field on records with no value yet (owners and admins).",
    input: fieldIdSchema,
    handler: (data, context) => {
      requireOrgPermission(context, { field: ["manage"] });
      return FieldsService.fill(context.organizationId, data.id);
    },
  }),
];

// A record's custom field values, under the record:
// /companies/{id}/fields, /contacts/{id}/fields, /deals/{id}/fields.
const RECORD_PATHS = [
  { path: "companies", entity: "COMPANY", tag: "Companies" },
  { path: "contacts", entity: "CONTACT", tag: "Contacts" },
  { path: "deals", entity: "DEAL", tag: "Deals" },
] as const satisfies { path: string; entity: FieldEntity; tag: string }[];

const recordId = z.object({ id: z.string().min(1).max(64) });

const valueRoutes = RECORD_PATHS.flatMap((record) => [
  apiRoute({
    method: "GET",
    path: `/${record.path}/{id}/fields`,
    tag: record.tag,
    summary:
      "The record's custom fields, each with its value (null when empty).",
    input: recordId,
    handler: (data, context) =>
      FieldValuesService.recordFields(
        context.organizationId,
        record.entity,
        data.id,
      ),
  }),
  apiRoute({
    method: "PATCH",
    path: `/${record.path}/{id}/fields`,
    tag: record.tag,
    summary:
      "Set custom field values by field key; null clears one. Every value is checked before any is written.",
    input: setRecordFieldValuesSchema
      .pick({ values: true })
      .extend(recordId.shape),
    handler: async (data, context) => {
      await FieldValuesService.setValues(
        context.organizationId,
        record.entity,
        data.id,
        data.values,
      );
      return FieldValuesService.recordFields(
        context.organizationId,
        record.entity,
        data.id,
      );
    },
  }),
]);

export const fieldRoutes = [...definitionRoutes, ...valueRoutes];
