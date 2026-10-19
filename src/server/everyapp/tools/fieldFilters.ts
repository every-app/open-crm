import { z } from "zod";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { memberId } from "@/server/everyapp/crm-tool";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { AppError } from "@/server/lib/errors";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import { ENTITY_NOUNS, type FieldValueJson } from "@/shared/fields";
import {
  fieldFiltersSchema,
  fieldValuesSchema,
  type FieldFilter,
  type FieldFilters,
} from "@/types/schemas/fields";

// Custom fields as the tools take and show them. People are named by email
// and a select's options by label or id, as the other tools take them. The
// app's own lists drop a filter they can't apply (a stale link still lists
// something); a model would take an unfiltered page for a filtered one, so
// here such a filter is an error.

/** The list tools' `fields` input. */
export const fieldFiltersInput = fieldFiltersSchema
  .optional()
  .describe(
    'Filters by custom field key (list_fields gives the keys and types). Text, URL, email and phone fields take { "op": "contains" | "equals", "value" }; numbers { "op": "range", "min", "max" }; dates { "op": "dateRange", "from", "to" } (YYYY-MM-DD, inclusive); checkboxes { "op": "checked", "value": true | false }; selects { "op": "anyOf", "values": [option labels or ids] }; user fields { "op": "anyOf", "values": [member emails] }.',
  );

/**
 * The record tools' `fields`: values written with the record, checked as
 * set_field_values checks them (withMemberIds, then the service).
 */
export const fieldValuesInput = fieldValuesSchema
  .optional()
  .describe(
    'Custom field values by key (list_fields), written with the record: a select takes an option\'s id or label, a date YYYY-MM-DD, a checkbox true or false, a user field a member\'s email; null clears. E.g. { "segment": "Enterprise" }.',
  );

/** A custom field's value: text, a number, a checkbox, or null when empty. */
export const fieldValueOutput = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/** A list row's values of the fields shown as table columns, by key. */
export const fieldColumnsOutput = z
  .record(z.string(), fieldValueOutput)
  .describe("Custom fields shown as columns, by key (a select as its label).");

/** A record's values of every live custom field, by key. */
export const recordValuesOutput = z
  .record(z.string(), fieldValueOutput)
  .describe(
    "Its custom fields by key (list_fields), null when empty: a select as its label, a user field as the member's email.",
  );

/** One record's custom field values as recordValuesOutput shows them. */
export async function recordValues(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<Record<string, FieldValueJson>> {
  const [fields, shown] = await Promise.all([
    FieldValuesService.recordFields(organizationId, entity, recordId),
    userFieldsByEmail(organizationId, entity),
  ]);
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.type === "SELECT"
        ? (field.options.find((option) => option.id === field.value)?.label ??
          null)
        : shown(field.key, field.value),
    ]),
  );
}

const OPS: Partial<Record<FieldType, FieldFilter["op"][]>> = {
  NUMBER: ["range"],
  DATE: ["dateRange"],
  CHECKBOX: ["checked"],
  SELECT: ["anyOf"],
  USER: ["anyOf"],
};
const TEXT_OPS: FieldFilter["op"][] = ["contains", "equals"];

/**
 * The filters as the list takes them: each key a live field of `entity`
 * filtered the way its type allows, select labels and member emails turned
 * into ids.
 */
export async function resolveFieldFilters(
  organizationId: string,
  entity: FieldEntity,
  filters: FieldFilters | undefined,
): Promise<FieldFilters> {
  const entries = Object.entries(filters ?? {});
  if (entries.length === 0) return {};
  const fields = await FieldsService.list(organizationId, entity);
  const resolved: FieldFilters = {};
  for (const [key, filter] of entries) {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field) {
      throw new AppError(
        "VALIDATION_ERROR",
        `There is no field called "${key}" on ${ENTITY_NOUNS[entity].many}. list_fields gives the keys.`,
      );
    }
    const ops = OPS[field.type] ?? TEXT_OPS;
    if (!ops.includes(filter.op)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${field.label} is a ${field.typeLabel.toLowerCase()} field: filter it with ${ops.map((op) => `"${op}"`).join(" or ")}.`,
      );
    }
    if (filter.op !== "anyOf") {
      resolved[key] = filter;
      continue;
    }
    const values: string[] = [];
    for (const value of filter.values) {
      if (field.type === "USER") {
        values.push(
          value.includes("@") ? await memberId(organizationId, value) : value,
        );
        continue;
      }
      const option = field.options.find(
        (candidate) =>
          candidate.id === value ||
          candidate.label.toLowerCase() === value.toLowerCase(),
      );
      if (!option) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field.label} has no option "${value}".`,
        );
      }
      values.push(option.id);
    }
    resolved[key] = { op: "anyOf", values };
  }
  return resolved;
}

/**
 * How the tools show an entity's field values: a user field's value as the
 * member's email instead of their user id. Members are read only when the
 * entity has a user field.
 */
export async function userFieldsByEmail(
  organizationId: string,
  entity: FieldEntity,
) {
  const userKeys = new Set(
    (await FieldsService.list(organizationId, entity))
      .filter((field) => field.type === "USER")
      .map((field) => field.key),
  );
  const emails = new Map(
    userKeys.size === 0
      ? []
      : (await AuthRepository.listMembers(organizationId)).map((member) => [
          member.userId,
          member.email,
        ]),
  );
  return (key: string, value: FieldValueJson): FieldValueJson =>
    userKeys.has(key) && typeof value === "string"
      ? (emails.get(value) ?? value)
      : value;
}

/** Values by field key as the service takes them: a user field's email as the member's id. */
export async function withMemberIds(
  organizationId: string,
  entity: FieldEntity,
  values: Record<string, FieldValueJson>,
) {
  const resolved = { ...values };
  for (const field of await FieldsService.list(organizationId, entity)) {
    const value = values[field.key];
    if (
      field.type === "USER" &&
      typeof value === "string" &&
      value.includes("@")
    ) {
      resolved[field.key] = await memberId(organizationId, value);
    }
  }
  return resolved;
}
