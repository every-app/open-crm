import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { fieldDefinition, fieldOption } from "@/db/schema";
import type { FieldEntity } from "@/shared/crm-enums";

export type FieldDefinitionRow = typeof fieldDefinition.$inferSelect;
export type FieldOptionRow = typeof fieldOption.$inferSelect;

/** A definition with all its options, retired ones included, in order. */
export type FieldDefinitionWithOptions = FieldDefinitionRow & {
  options: FieldOptionRow[];
};

type NewDefinition = Omit<
  typeof fieldDefinition.$inferInsert,
  "archivedAt" | "createdAt" | "updatedAt"
>;

type DefinitionPatch = Partial<
  Pick<
    FieldDefinitionRow,
    | "label"
    | "type"
    | "required"
    | "showOnSheet"
    | "showOnTable"
    | "showOnFilter"
  >
>;

/** What an edit does to a select's options, by option id. */
export type OptionChanges = {
  keep: { id: string; label: string; position: number }[];
  create: { label: string; position: number }[];
  retire: string[];
};

// Option rows bind 5 parameters each; D1 takes about 100 per statement.
const OPTION_ROWS_PER_INSERT = 15;
const IDS_PER_STATEMENT = 90;

function attachOptions(
  definitions: FieldDefinitionRow[],
  options: FieldOptionRow[],
): FieldDefinitionWithOptions[] {
  return definitions.map((definition) => ({
    ...definition,
    options: options.filter((option) => option.fieldId === definition.id),
  }));
}

/** An entity's fields in sheet order, with their options. */
async function list(
  organizationId: string,
  entity: FieldEntity,
  { includeArchived }: { includeArchived: boolean },
): Promise<FieldDefinitionWithOptions[]> {
  const definitions = await db
    .select()
    .from(fieldDefinition)
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.entity, entity),
        includeArchived ? undefined : isNull(fieldDefinition.archivedAt),
      ),
    )
    .orderBy(asc(fieldDefinition.position), asc(fieldDefinition.createdAt));
  if (definitions.length === 0) return [];

  const options = await db
    .select({ option: fieldOption })
    .from(fieldOption)
    .innerJoin(fieldDefinition, eq(fieldDefinition.id, fieldOption.fieldId))
    .where(
      and(
        eq(fieldOption.organizationId, organizationId),
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.entity, entity),
      ),
    )
    .orderBy(asc(fieldOption.position));
  return attachOptions(
    definitions,
    options.map((row) => row.option),
  );
}

async function findById(
  organizationId: string,
  id: string,
): Promise<FieldDefinitionWithOptions | null> {
  const [definition] = await db
    .select()
    .from(fieldDefinition)
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.id, id),
      ),
    )
    .limit(1);
  if (!definition) return null;
  const options = await db
    .select()
    .from(fieldOption)
    .where(
      and(
        eq(fieldOption.organizationId, organizationId),
        eq(fieldOption.fieldId, id),
      ),
    )
    .orderBy(asc(fieldOption.position));
  return { ...definition, options };
}

/** Whether `key` is taken on the entity, by a live or an archived field. */
async function keyTaken(
  organizationId: string,
  entity: FieldEntity,
  key: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: fieldDefinition.id })
    .from(fieldDefinition)
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.entity, entity),
        eq(fieldDefinition.key, key),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The position after the entity's last field. */
async function nextPosition(
  organizationId: string,
  entity: FieldEntity,
): Promise<number> {
  const [row] = await db
    .select({ last: max(fieldDefinition.position) })
    .from(fieldDefinition)
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.entity, entity),
      ),
    );
  return (row?.last ?? -1) + 1;
}

/** Inserts a field and its options together. */
async function insert(
  definition: NewDefinition,
  options: { label: string; position: number }[],
): Promise<void> {
  const optionRows = options.map((option) => ({
    id: crypto.randomUUID(),
    organizationId: definition.organizationId,
    fieldId: definition.id,
    label: option.label,
    position: option.position,
  }));
  await runBatch((tx) => [
    tx.insert(fieldDefinition).values(definition),
    ...chunk(optionRows, OPTION_ROWS_PER_INSERT).map((rows) =>
      tx.insert(fieldOption).values(rows),
    ),
  ]);
}

/**
 * Updates a field and, for a select, its options, together. Retired options
 * keep their rows, so the values that point at them still read.
 */
async function update(
  organizationId: string,
  id: string,
  patch: DefinitionPatch,
  options: OptionChanges | null,
): Promise<void> {
  const now = new Date().toISOString();
  const ofField = (optionId: string) =>
    and(
      eq(fieldOption.organizationId, organizationId),
      eq(fieldOption.fieldId, id),
      eq(fieldOption.id, optionId),
    );
  await runBatch((tx) => [
    ...chunk(options?.retire ?? [], IDS_PER_STATEMENT).map((ids) =>
      tx
        .update(fieldOption)
        .set({ archivedAt: now })
        .where(
          and(
            eq(fieldOption.organizationId, organizationId),
            eq(fieldOption.fieldId, id),
            inArray(fieldOption.id, ids),
          ),
        ),
    ),
    ...(options?.keep ?? []).map((option) =>
      tx
        .update(fieldOption)
        .set({
          label: option.label,
          position: option.position,
          archivedAt: null,
        })
        .where(ofField(option.id)),
    ),
    ...chunk(
      (options?.create ?? []).map((option) => ({
        id: crypto.randomUUID(),
        organizationId,
        fieldId: id,
        label: option.label,
        position: option.position,
      })),
      OPTION_ROWS_PER_INSERT,
    ).map((rows) => tx.insert(fieldOption).values(rows)),
    tx
      .update(fieldDefinition)
      .set({ ...patch, updatedAt: now })
      .where(
        and(
          eq(fieldDefinition.organizationId, organizationId),
          eq(fieldDefinition.id, id),
        ),
      ),
  ]);
}

/** Rewrites the entity's field positions in the order of `ids`. */
async function reorder(
  organizationId: string,
  entity: FieldEntity,
  ids: string[],
): Promise<void> {
  const now = new Date().toISOString();
  await runBatch((tx) =>
    ids.map((id, position) =>
      tx
        .update(fieldDefinition)
        .set({ position, updatedAt: now })
        .where(
          and(
            eq(fieldDefinition.organizationId, organizationId),
            eq(fieldDefinition.entity, entity),
            eq(fieldDefinition.id, id),
          ),
        ),
    ),
  );
}

/** Archives (a timestamp) or restores (null) a field. False when there is none. */
async function setArchivedAt(
  organizationId: string,
  id: string,
  archivedAt: string | null,
): Promise<boolean> {
  const updated = await db
    .update(fieldDefinition)
    .set({ archivedAt, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.id, id),
      ),
    )
    .returning({ id: fieldDefinition.id });
  return updated.length > 0;
}

/** Deletes a field; its options and values go with it. False when there is none. */
async function remove(organizationId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(fieldDefinition)
    .where(
      and(
        eq(fieldDefinition.organizationId, organizationId),
        eq(fieldDefinition.id, id),
      ),
    )
    .returning({ id: fieldDefinition.id });
  return deleted.length > 0;
}

export const FieldDefinitionRepository = {
  list,
  findById,
  keyTaken,
  nextPosition,
  insert,
  update,
  reorder,
  setArchivedAt,
  remove,
};
