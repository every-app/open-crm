import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { company, contact, deal, fieldValue } from "@/db/schema";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldValueJson } from "@/shared/fields";
import type { FieldFilter } from "@/types/schemas/fields";

type FieldValueRow = typeof fieldValue.$inferSelect;

/** One parsed value for one field; null clears it. */
export type FieldWrite = {
  fieldId: string;
  type: FieldType;
  value: FieldValueJson;
};

// D1 binds about 100 parameters per statement.
const IDS_PER_STATEMENT = 90;

// Resolved per call, not at import: `@/db/schema` hands out whichever
// dialect's tables are live.
function records(entity: FieldEntity) {
  switch (entity) {
    case "COMPANY":
      return {
        table: company,
        id: company.id,
        organizationId: company.organizationId,
        archivedAt: company.archivedAt,
        valueRecordId: fieldValue.companyId,
      };
    case "CONTACT":
      return {
        table: contact,
        id: contact.id,
        organizationId: contact.organizationId,
        archivedAt: contact.archivedAt,
        valueRecordId: fieldValue.contactId,
      };
    case "DEAL":
      return {
        table: deal,
        id: deal.id,
        organizationId: deal.organizationId,
        archivedAt: deal.archivedAt,
        valueRecordId: fieldValue.dealId,
      };
  }
}

function recordReference(entity: FieldEntity, recordId: string) {
  switch (entity) {
    case "COMPANY":
      return { companyId: recordId };
    case "CONTACT":
      return { contactId: recordId };
    case "DEAL":
      return { dealId: recordId };
  }
}

/** The typed columns of a value row: only the one its type uses is set. */
function storedColumns(type: FieldType, value: string | number | boolean) {
  const columns = {
    text: null as string | null,
    number: null as number | null,
    date: null as string | null,
    bool: null as boolean | null,
    optionId: null as string | null,
    userId: null as string | null,
  };
  if (type === "NUMBER" && typeof value === "number") columns.number = value;
  else if (type === "CHECKBOX" && typeof value === "boolean")
    columns.bool = value;
  else if (typeof value !== "string")
    throw new Error(`A ${type} field can't store ${typeof value}`);
  else if (type === "DATE") columns.date = value;
  else if (type === "SELECT") columns.optionId = value;
  else if (type === "USER") columns.userId = value;
  else columns.text = value;
  return columns;
}

/** A value row read back as its field's type. */
export function storedValue(
  type: FieldType,
  row: FieldValueRow,
): FieldValueJson {
  switch (type) {
    case "CHECKBOX":
      return row.bool ?? null;
    case "NUMBER":
      return row.number ?? null;
    case "DATE":
      return row.date ?? null;
    case "SELECT":
      return row.optionId ?? null;
    case "USER":
      return row.userId ?? null;
    default:
      return row.text ?? null;
  }
}

/** Whether the organization has this company, contact or deal. */
async function recordExists(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<boolean> {
  const record = records(entity);
  const [row] = await db
    .select({ id: record.id })
    .from(record.table)
    .where(
      and(eq(record.organizationId, organizationId), eq(record.id, recordId)),
    )
    .limit(1);
  return Boolean(row);
}

/** Every custom field value one record has. */
async function listForRecord(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
): Promise<FieldValueRow[]> {
  const record = records(entity);
  return db
    .select()
    .from(fieldValue)
    .where(
      and(
        eq(fieldValue.organizationId, organizationId),
        eq(record.valueRecordId, recordId),
      ),
    );
}

/**
 * Every custom field value of many records of one entity, for table columns:
 * one query per 90 records, so a page of any size stays inside D1's
 * parameter limit.
 */
async function listForRecords(
  organizationId: string,
  entity: FieldEntity,
  recordIds: string[],
): Promise<FieldValueRow[]> {
  const record = records(entity);
  const rows: FieldValueRow[] = [];
  for (const ids of chunk([...new Set(recordIds)], IDS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select()
        .from(fieldValue)
        .where(
          and(
            eq(fieldValue.organizationId, organizationId),
            inArray(record.valueRecordId, ids),
          ),
        )),
    );
  }
  return rows;
}

/**
 * The statements that write values onto one record, for a batch: a value
 * upserts its row (one per field and record, field_value's unique indexes),
 * null deletes it. A record's create or update puts them in its own batch,
 * so the record and its values are written together.
 */
export function fieldValueWrites(
  tx: typeof db,
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
  writes: FieldWrite[],
) {
  const record = records(entity);
  const reference = recordReference(entity, recordId);
  const now = new Date().toISOString();
  return writes.map(({ fieldId, type, value }) => {
    if (value === null) {
      return tx
        .delete(fieldValue)
        .where(
          and(
            eq(fieldValue.organizationId, organizationId),
            eq(fieldValue.fieldId, fieldId),
            eq(record.valueRecordId, recordId),
          ),
        );
    }
    const columns = storedColumns(type, value);
    return tx
      .insert(fieldValue)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        fieldId,
        ...reference,
        ...columns,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [fieldValue.fieldId, record.valueRecordId],
        set: { ...columns, updatedAt: now },
      });
  });
}

/** Writes values onto one record, all or nothing (fieldValueWrites). */
async function write(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
  writes: FieldWrite[],
): Promise<void> {
  await runBatch((tx) =>
    fieldValueWrites(tx, organizationId, entity, recordId, writes),
  );
}

/**
 * Writes a value only where the record has none for the field yet, in one
 * statement, so a value someone saved meanwhile is never overwritten. True
 * when it was written.
 */
async function insertIfEmpty(
  organizationId: string,
  entity: FieldEntity,
  recordId: string,
  { fieldId, type, value }: FieldWrite,
): Promise<boolean> {
  if (value === null) return false;
  const record = records(entity);
  const inserted = await db
    .insert(fieldValue)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      fieldId,
      ...recordReference(entity, recordId),
      ...storedColumns(type, value),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing({
      target: [fieldValue.fieldId, record.valueRecordId],
    })
    .returning({ id: fieldValue.id });
  return inserted.length > 0;
}

/** How many records hold a value for the field, archived ones included. */
async function countForField(
  organizationId: string,
  fieldId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(fieldValue)
    .where(
      and(
        eq(fieldValue.organizationId, organizationId),
        eq(fieldValue.fieldId, fieldId),
      ),
    );
  return row?.count ?? 0;
}

/** Live (unarchived) records of the entity, and how many have the field filled. */
async function coverage(
  organizationId: string,
  entity: FieldEntity,
  fieldId: string,
): Promise<{ filled: number; total: number }> {
  const record = records(entity);
  const [filled] = await db
    .select({ count: count() })
    .from(fieldValue)
    .innerJoin(record.table, eq(record.id, record.valueRecordId))
    .where(
      and(
        eq(fieldValue.organizationId, organizationId),
        eq(fieldValue.fieldId, fieldId),
        eq(record.organizationId, organizationId),
        isNull(record.archivedAt),
      ),
    );
  const [total] = await db
    .select({ count: count() })
    .from(record.table)
    .where(
      and(eq(record.organizationId, organizationId), isNull(record.archivedAt)),
    );
  return { filled: filled?.count ?? 0, total: total?.count ?? 0 };
}

/**
 * Up to `limit` live records with no value for the field, by id after
 * `after`: page through them by passing the last id back.
 */
async function missingRecordIds(
  organizationId: string,
  entity: FieldEntity,
  fieldId: string,
  { after, limit }: { after?: string; limit: number },
): Promise<string[]> {
  const record = records(entity);
  const rows = await db
    .select({ id: record.id })
    .from(record.table)
    .where(
      and(
        eq(record.organizationId, organizationId),
        isNull(record.archivedAt),
        after === undefined ? undefined : gt(record.id, after),
        notExists(
          db
            .select({ one: sql`1` })
            .from(fieldValue)
            .where(
              and(
                eq(fieldValue.organizationId, organizationId),
                eq(fieldValue.fieldId, fieldId),
                eq(record.valueRecordId, record.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(record.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

const TEXT_TYPES = new Set<FieldType>([
  "TEXT",
  "LONG_TEXT",
  "URL",
  "EMAIL",
  "PHONE",
]);

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

/**
 * The condition a list query puts on its record table (`company`, `contact`
 * or `deal`, selected under its own name and filtered by its organization)
 * for one field filter: an EXISTS over the record's value row, the same SQL
 * on SQLite and Postgres. Null when the filter doesn't fit the field's type.
 */
function filterCondition(
  entity: FieldEntity,
  field: { id: string; type: FieldType },
  filter: FieldFilter,
): SQL | null {
  const record = records(entity);
  // The value row's organization is the record's, which the list binds
  // once: each filter binds only its field and its values, so many filters
  // fit D1's parameter limit (fieldFiltersSchema counts them).
  const valueWhere = (condition: SQL | undefined) =>
    db
      .select({ one: sql`1` })
      .from(fieldValue)
      .where(
        and(
          eq(fieldValue.organizationId, record.organizationId),
          eq(fieldValue.fieldId, field.id),
          eq(record.valueRecordId, record.id),
          condition,
        ),
      );

  switch (filter.op) {
    case "contains":
      if (!TEXT_TYPES.has(field.type)) return null;
      return exists(
        valueWhere(
          sql`lower(${fieldValue.text}) like lower(${`%${escapeLike(filter.value)}%`}) escape '\\'`,
        ),
      );
    case "equals":
      if (!TEXT_TYPES.has(field.type)) return null;
      return exists(
        valueWhere(sql`lower(${fieldValue.text}) = lower(${filter.value})`),
      );
    case "range":
      if (field.type !== "NUMBER") return null;
      return exists(
        valueWhere(
          and(
            filter.min === undefined
              ? undefined
              : gte(fieldValue.number, filter.min),
            filter.max === undefined
              ? undefined
              : lte(fieldValue.number, filter.max),
          ),
        ),
      );
    case "dateRange":
      if (field.type !== "DATE") return null;
      return exists(
        valueWhere(
          and(
            filter.from === undefined
              ? undefined
              : gte(fieldValue.date, `${filter.from}T00:00:00.000Z`),
            filter.to === undefined
              ? undefined
              : lt(fieldValue.date, nextDay(filter.to)),
          ),
        ),
      );
    case "checked": {
      if (field.type !== "CHECKBOX") return null;
      // Unchecked is a false value or none at all.
      const checked = valueWhere(eq(fieldValue.bool, true));
      return filter.value ? exists(checked) : notExists(checked);
    }
    case "anyOf":
      if (field.type === "SELECT") {
        return exists(valueWhere(inArray(fieldValue.optionId, filter.values)));
      }
      if (field.type === "USER") {
        return exists(valueWhere(inArray(fieldValue.userId, filter.values)));
      }
      return null;
  }
}

export const FieldValueRepository = {
  recordExists,
  listForRecord,
  listForRecords,
  write,
  insertIfEmpty,
  countForField,
  coverage,
  missingRecordIds,
  filterCondition,
};
