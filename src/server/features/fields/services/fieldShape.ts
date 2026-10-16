import { sortBy } from "remeda";
import type { FieldDefinitionWithOptions } from "@/server/features/fields/repositories/FieldDefinitionRepository";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import { FIELD_TYPE_LABELS, type FieldValueJson } from "@/shared/fields";

export type FieldOption = { id: string; label: string; position: number };

/** A custom field as the app, the API and the agent see it. */
export type Field = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  typeLabel: string;
  agentFilled: boolean;
  agentBrief: string | null;
  required: boolean;
  showOnSheet: boolean;
  showOnTable: boolean;
  showOnFilter: boolean;
  position: number;
  archived: boolean;
  /** Live options in order (selects only). */
  options: FieldOption[];
};

/** A field with one record's value of it. */
export type RecordField = Field & { value: FieldValueJson };

function toOption(option: FieldDefinitionWithOptions["options"][number]) {
  return { id: option.id, label: option.label, position: option.position };
}

export function serializeField(definition: FieldDefinitionWithOptions): Field {
  return {
    id: definition.id,
    entity: definition.entity,
    key: definition.key,
    label: definition.label,
    type: definition.type,
    typeLabel: FIELD_TYPE_LABELS[definition.type],
    agentFilled: definition.agentFilled,
    agentBrief: definition.agentBrief,
    required: definition.required,
    showOnSheet: definition.showOnSheet,
    showOnTable: definition.showOnTable,
    showOnFilter: definition.showOnFilter,
    position: definition.position,
    archived: definition.archivedAt !== null,
    options: definition.options
      .filter((option) => option.archivedAt === null)
      .map(toOption),
  };
}

/**
 * The field for one record: a select whose value is a retired option lists
 * that option too, so the record still shows what it holds.
 */
export function serializeRecordField(
  definition: FieldDefinitionWithOptions,
  value: FieldValueJson,
): RecordField {
  const field = serializeField(definition);
  const retired =
    definition.type === "SELECT" &&
    typeof value === "string" &&
    !field.options.some((option) => option.id === value)
      ? definition.options.find((option) => option.id === value)
      : undefined;
  return {
    ...field,
    options: retired
      ? sortBy(
          [...field.options, toOption(retired)],
          (option) => option.position,
        )
      : field.options,
    value,
  };
}
