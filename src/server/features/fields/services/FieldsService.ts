import {
  FieldDefinitionRepository,
  type FieldDefinitionWithOptions,
  type OptionChanges,
} from "@/server/features/fields/repositories/FieldDefinitionRepository";
import { FieldValueRepository } from "@/server/features/fields/repositories/FieldValueRepository";
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

/** Adds a field. Its key comes from the label and never changes. */
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

  return serializeField(await requireDefinition(organizationId, id));
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
      required: input.required,
      showOnSheet: input.showOnSheet,
      showOnTable: input.showOnTable,
      showOnFilter: input.showOnFilter,
    },
    options,
  );

  return serializeField(await requireDefinition(organizationId, existing.id));
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

export const FieldsService = {
  list,
  create,
  update,
  reorder,
  archive,
  restore,
  remove,
  coverage,
};
