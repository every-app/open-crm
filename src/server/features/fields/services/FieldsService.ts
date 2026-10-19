import {
  FieldDefinitionRepository,
  type FieldDefinitionWithOptions,
  type OptionChanges,
} from "@/server/features/fields/repositories/FieldDefinitionRepository";
import { FieldValueRepository } from "@/server/features/fields/repositories/FieldValueRepository";
import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { AppError } from "@/server/lib/errors";
import {
  serializeField,
  type Field,
} from "@/server/features/fields/services/fieldShape";
import type { FieldEntity } from "@/shared/crm-enums";
import { fieldKeyFromLabel, usesOptions } from "@/shared/fields";
import type {
  CreateFieldInput,
  FieldOptionInput,
  UpdateFieldInput,
} from "@/types/schemas/fields";

type FieldCoverage = {
  /** Live records with a value. */
  filled: number;
  /** Live records. */
  total: number;
  /** Every value the field holds, archived records' included. */
  values: number;
};

// "Ask the agent to fill" queues records in chunks, up to a cap per ask (the
// CRM's maxRecordsPerRun): each record is a row in the agent's queue.
const BACKFILL_CHUNK = 100;
const BACKFILL_MAX_RECORDS = 500;

async function requireDefinition(
  organizationId: string,
  id: string,
): Promise<FieldDefinitionWithOptions> {
  const definition = await FieldDefinitionRepository.findById(
    organizationId,
    id,
  );
  if (!definition)
    throw new AppError("NOT_FOUND", "That field does not exist.");
  return definition;
}

function assertOptions(options: FieldOptionInput[]): void {
  if (options.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A select needs at least one option.",
    );
  }
  const labels = options.map((option) => option.label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Two options of a select can't have the same label.",
    );
  }
}

/** An entity's fields in sheet order. */
async function list(
  organizationId: string,
  entity: FieldEntity,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<Field[]> {
  const definitions = await FieldDefinitionRepository.list(
    organizationId,
    entity,
    { includeArchived },
  );
  return definitions.map(serializeField);
}

/**
 * Queues the agent to fill `definition` on live records that have no value,
 * a chunk at a time up to the cap. Records that already have an open
 * backfill get this field's key merged in.
 */
async function queueFill(
  organizationId: string,
  definition: FieldDefinitionWithOptions,
  reason: string,
): Promise<{ queued: number; merged: number }> {
  let queued = 0;
  let merged = 0;
  let after: string | undefined;
  for (let seen = 0; seen < BACKFILL_MAX_RECORDS; ) {
    const limit = Math.min(BACKFILL_CHUNK, BACKFILL_MAX_RECORDS - seen);
    const ids = await FieldValueRepository.missingRecordIds(
      organizationId,
      definition.entity,
      definition.id,
      { after, limit },
    );
    if (ids.length === 0) break;
    const result = await AgentTaskService.fieldBackfillRecords(
      organizationId,
      definition.entity,
      [definition.key],
      ids,
      reason,
    );
    queued += result.queued;
    merged += result.merged;
    seen += ids.length;
    after = ids.at(-1);
    if (ids.length < limit) break;
  }
  return { queued, merged };
}

/** A fill nobody asked for (a new or re-briefed field) never fails the save. */
async function queueFillQuietly(
  organizationId: string,
  definition: FieldDefinitionWithOptions,
  reason: string,
): Promise<void> {
  try {
    await queueFill(organizationId, definition, reason);
  } catch (error) {
    console.error(
      "[fields] could not queue the agent to fill a field",
      { organizationId, fieldId: definition.id },
      error,
    );
  }
}

/**
 * Adds a field. Its key comes from the label and never changes; a field the
 * agent fills is queued for the records that exist.
 */
async function create(
  organizationId: string,
  input: CreateFieldInput,
): Promise<Field> {
  const key = fieldKeyFromLabel(input.label);
  if (!key) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That label does not make a usable key.",
    );
  }
  if (
    await FieldDefinitionRepository.keyTaken(organizationId, input.entity, key)
  ) {
    throw new AppError("CONFLICT", `There is already a field called "${key}".`);
  }
  const options = usesOptions(input.type) ? input.options : [];
  if (usesOptions(input.type)) assertOptions(options);

  const id = crypto.randomUUID();
  try {
    await FieldDefinitionRepository.insert(
      {
        id,
        organizationId,
        entity: input.entity,
        key,
        label: input.label,
        type: input.type,
        agentFilled: input.agentFilled,
        agentBrief: input.agentBrief || null,
        required: input.required,
        showOnSheet: input.showOnSheet,
        showOnTable: input.showOnTable,
        showOnFilter: input.showOnFilter,
        position: await FieldDefinitionRepository.nextPosition(
          organizationId,
          input.entity,
        ),
      },
      options.map((option, position) => ({ label: option.label, position })),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        `There is already a field called "${key}".`,
      );
    }
    throw error;
  }

  const definition = await requireDefinition(organizationId, id);
  if (definition.agentFilled) {
    await queueFillQuietly(
      organizationId,
      definition,
      `New field: ${definition.label}`,
    );
  }
  return serializeField(definition);
}

function optionChanges(
  existing: FieldDefinitionWithOptions,
  options: FieldOptionInput[],
): OptionChanges {
  const known = new Set(existing.options.map((option) => option.id));
  const kept = new Set<string>();
  const changes: OptionChanges = { keep: [], create: [], retire: [] };
  options.forEach((option, position) => {
    if (option.id === undefined) {
      changes.create.push({ label: option.label, position });
      return;
    }
    if (!known.has(option.id)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "That option is not on this field.",
      );
    }
    kept.add(option.id);
    changes.keep.push({ id: option.id, label: option.label, position });
  });
  changes.retire = existing.options
    .filter((option) => option.archivedAt === null && !kept.has(option.id))
    .map((option) => option.id);
  return changes;
}

/**
 * Changes a field. Its type can only change while it holds no values;
 * removing a select's option retires it (values that use it keep reading).
 * A new brief, or the agent turned on, queues the agent again.
 */
async function update(
  organizationId: string,
  input: UpdateFieldInput,
): Promise<Field> {
  const existing = await requireDefinition(organizationId, input.id);
  const type = input.type ?? existing.type;

  if (
    type !== existing.type &&
    (await FieldValueRepository.countForField(organizationId, existing.id)) > 0
  ) {
    throw new AppError(
      "CONFLICT",
      "This field already holds values, so its type cannot change. Archive it and make a new one.",
    );
  }

  let options: OptionChanges | null = null;
  if (usesOptions(type)) {
    const next =
      input.options ??
      existing.options
        .filter((option) => option.archivedAt === null)
        .map((option) => ({ id: option.id, label: option.label }));
    assertOptions(next);
    if (input.options) options = optionChanges(existing, input.options);
  }

  await FieldDefinitionRepository.update(
    organizationId,
    existing.id,
    {
      label: input.label,
      type: input.type,
      agentFilled: input.agentFilled,
      agentBrief:
        input.agentBrief === undefined ? undefined : input.agentBrief || null,
      required: input.required,
      showOnSheet: input.showOnSheet,
      showOnTable: input.showOnTable,
      showOnFilter: input.showOnFilter,
    },
    options,
  );

  const definition = await requireDefinition(organizationId, existing.id);
  const briefChanged = definition.agentBrief !== existing.agentBrief;
  const turnedOn = definition.agentFilled && !existing.agentFilled;
  if (
    definition.agentFilled &&
    definition.archivedAt === null &&
    (briefChanged || turnedOn)
  ) {
    await queueFillQuietly(
      organizationId,
      definition,
      briefChanged
        ? `Brief changed: ${definition.label}`
        : `Turned on: ${definition.label}`,
    );
  }
  return serializeField(definition);
}

/** Puts an entity's live fields in the order of `ids`, which names each once. */
async function reorder(
  organizationId: string,
  entity: FieldEntity,
  ids: string[],
): Promise<Field[]> {
  const live = await FieldDefinitionRepository.list(organizationId, entity, {
    includeArchived: false,
  });
  const liveIds = new Set(live.map((definition) => definition.id));
  if (
    ids.length !== liveIds.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !liveIds.has(id))
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That order doesn't name each of this record type's fields once.",
    );
  }
  await FieldDefinitionRepository.reorder(organizationId, entity, ids);
  return list(organizationId, entity);
}

/** Hides a field everywhere and keeps its values. */
async function archive(organizationId: string, id: string): Promise<Field> {
  if (
    !(await FieldDefinitionRepository.setArchivedAt(
      organizationId,
      id,
      new Date().toISOString(),
    ))
  ) {
    throw new AppError("NOT_FOUND", "That field does not exist.");
  }
  return serializeField(await requireDefinition(organizationId, id));
}

async function restore(organizationId: string, id: string): Promise<Field> {
  if (
    !(await FieldDefinitionRepository.setArchivedAt(organizationId, id, null))
  ) {
    throw new AppError("NOT_FOUND", "That field does not exist.");
  }
  return serializeField(await requireDefinition(organizationId, id));
}

/** Deletes a field and every value it holds, for good. */
async function remove(
  organizationId: string,
  id: string,
): Promise<{ id: string }> {
  if (!(await FieldDefinitionRepository.remove(organizationId, id))) {
    throw new AppError("NOT_FOUND", "That field does not exist.");
  }
  return { id };
}

async function coverage(
  organizationId: string,
  id: string,
): Promise<FieldCoverage> {
  const definition = await requireDefinition(organizationId, id);
  const [live, values] = await Promise.all([
    FieldValueRepository.coverage(organizationId, definition.entity, id),
    FieldValueRepository.countForField(organizationId, id),
  ]);
  return { ...live, values };
}

/** "Ask the agent to fill": queues the live records still missing a value. */
async function fill(
  organizationId: string,
  id: string,
): Promise<{ queued: number; merged: number }> {
  const definition = await requireDefinition(organizationId, id);
  if (!definition.agentFilled || definition.archivedAt !== null) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The agent does not fill this field, so there is nothing to run.",
    );
  }
  return queueFill(organizationId, definition, "Asked to fill the rest");
}

/**
 * For a record that was just created: the fields the agent fills that it
 * wasn't created with a value for, queued once for all of them. Never fails
 * the caller.
 */
async function queueFillForNewRecord(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<void> {
  try {
    const agentFilled = (
      await FieldDefinitionRepository.list(organizationId, entity, {
        includeArchived: false,
      })
    ).filter((definition) => definition.agentFilled);
    if (agentFilled.length === 0) return;
    const given = new Set(
      (
        await FieldValueRepository.listForRecord(
          organizationId,
          entity,
          recordId,
        )
      ).map((value) => value.fieldId),
    );
    const keys = agentFilled
      .filter((definition) => !given.has(definition.id))
      .map((definition) => definition.key);
    if (keys.length === 0) return;
    await AgentTaskService.fieldBackfillRecords(
      organizationId,
      entity,
      keys,
      [recordId],
      "New record",
    );
  } catch (error) {
    console.error(
      "[fields] could not queue the agent for a new record",
      { organizationId, entity, recordId },
      error,
    );
  }
}

export const FieldsService = {
  list,
  create,
  update,
  reorder,
  archive,
  restore,
  remove,
  coverage,
  fill,
  queueFillForNewRecord,
};
