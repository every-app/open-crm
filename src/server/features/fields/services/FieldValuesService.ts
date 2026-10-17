import type { SQL } from "drizzle-orm";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { FieldDefinitionRepository } from "@/server/features/fields/repositories/FieldDefinitionRepository";
import {
  FieldValueRepository,
  storedValue,
  type FieldWrite,
} from "@/server/features/fields/repositories/FieldValueRepository";
import {
  serializeRecordField,
  type RecordField,
} from "@/server/features/fields/services/fieldShape";
import { AppError } from "@/server/lib/errors";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  ENTITY_NOUNS,
  parseFieldValue,
  type FieldValueJson,
} from "@/shared/fields";
import type { FieldFilters } from "@/types/schemas/fields";

async function requireRecord(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<void> {
  if (
    !(await FieldValueRepository.recordExists(organizationId, entity, recordId))
  ) {
    throw new AppError(
      "NOT_FOUND",
      `No ${ENTITY_NOUNS[entity].one} with id ${recordId}.`,
    );
  }
}

/** A record's live fields in sheet order, each with the record's value. */
async function recordFields(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<RecordField[]> {
  await requireRecord(organizationId, entity, recordId);
  const [definitions, rows] = await Promise.all([
    FieldDefinitionRepository.list(organizationId, entity, {
      includeArchived: false,
    }),
    FieldValueRepository.listForRecord(organizationId, entity, recordId),
  ]);
  const byField = new Map(rows.map((row) => [row.fieldId, row]));
  return definitions.map((definition) => {
    const row = byField.get(definition.id);
    return serializeRecordField(
      definition,
      row ? storedValue(definition.type, row) : null,
    );
  });
}

/**
 * Sets custom field values on one record, by field key: the one write path
 * for people and the agent. Every value is checked against its field (its
 * type, a select's options, required; a user must work here) before anything
 * is written, then they are written together. Null clears a value.
 *
 * With `onlyIfEmpty` (the agent filling blanks), a value is written only
 * where the record has none, so nobody's value is ever overwritten; the keys
 * it left alone come back as `skipped`.
 */
async function setValues(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
  values: Record<string, unknown>,
  { onlyIfEmpty = false }: { onlyIfEmpty?: boolean } = {},
): Promise<{ written: string[]; skipped: string[] }> {
  await requireRecord(organizationId, entity, recordId);
  const byKey = new Map(
    (
      await FieldDefinitionRepository.list(organizationId, entity, {
        includeArchived: false,
      })
    ).map((definition) => [definition.key, definition]),
  );

  const writes: (FieldWrite & { key: string })[] = [];
  for (const [key, input] of Object.entries(values)) {
    const definition = byKey.get(key);
    if (!definition) {
      throw new AppError(
        "VALIDATION_ERROR",
        `There is no field called "${key}" on ${ENTITY_NOUNS[entity].many}.`,
      );
    }
    const parsed = parseFieldValue(
      {
        ...definition,
        options: definition.options.map((option) => ({
          id: option.id,
          label: option.label,
          archived: option.archivedAt !== null,
        })),
      },
      input,
    );
    if (!parsed.ok) throw new AppError("VALIDATION_ERROR", parsed.message);
    if (
      definition.type === "USER" &&
      typeof parsed.value === "string" &&
      !(await AuthRepository.isMember(organizationId, parsed.value))
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${definition.label} takes someone who works here.`,
      );
    }
    writes.push({
      key,
      fieldId: definition.id,
      type: definition.type,
      value: parsed.value,
    });
  }

  if (!onlyIfEmpty) {
    await FieldValueRepository.write(organizationId, entity, recordId, writes);
    return { written: writes.map((write) => write.key), skipped: [] };
  }
  const written: string[] = [];
  const skipped: string[] = [];
  for (const write of writes) {
    const inserted = await FieldValueRepository.insertIfEmpty(
      organizationId,
      entity,
      recordId,
      write,
    );
    (inserted ? written : skipped).push(write.key);
  }
  return { written, skipped };
}

/**
 * For a list page's custom columns: the values of the fields shown on the
 * table (`showOnTable`) for a page of records, by record id then field key.
 * A select's value is its option's label, so a cell needs nothing else.
 */
async function tableValues(
  organizationId: string,
  entity: FieldEntity,
  recordIds: string[],
): Promise<Record<string, Record<string, FieldValueJson>>> {
  const byRecord: Record<string, Record<string, FieldValueJson>> = {};
  if (recordIds.length === 0) return byRecord;
  const columns = (
    await FieldDefinitionRepository.list(organizationId, entity, {
      includeArchived: false,
    })
  ).filter((definition) => definition.showOnTable);
  if (columns.length === 0) return byRecord;

  const byId = new Map(
    columns.map((definition) => [definition.id, definition]),
  );
  for (const row of await FieldValueRepository.listForRecords(
    organizationId,
    entity,
    recordIds,
  )) {
    const definition = byId.get(row.fieldId);
    const recordId = row.companyId ?? row.contactId ?? row.dealId;
    if (!definition || !recordId) continue;
    const value = storedValue(definition.type, row);
    (byRecord[recordId] ??= {})[definition.key] =
      definition.type === "SELECT" && typeof value === "string"
        ? (definition.options.find((option) => option.id === value)?.label ??
          null)
        : value;
  }
  return byRecord;
}

/**
 * The conditions a list query of `entity` adds to its WHERE for custom field
 * filters (by field key): one EXISTS per filter, against the record table
 * selected under its own name. Filters on fields that don't exist (anymore)
 * or that don't fit their field's type are dropped, so a stale URL or saved
 * view still lists something.
 */
async function filterConditions(
  organizationId: string,
  entity: FieldEntity,
  filters: FieldFilters,
): Promise<SQL[]> {
  const entries = Object.entries(filters);
  if (entries.length === 0) return [];
  const byKey = new Map(
    (
      await FieldDefinitionRepository.list(organizationId, entity, {
        includeArchived: false,
      })
    ).map((definition) => [definition.key, definition]),
  );
  return entries.flatMap(([key, filter]) => {
    const definition = byKey.get(key);
    const condition = definition
      ? FieldValueRepository.filterCondition(entity, definition, filter)
      : null;
    return condition ? [condition] : [];
  });
}

export const FieldValuesService = {
  recordFields,
  setValues,
  tableValues,
  filterConditions,
};
