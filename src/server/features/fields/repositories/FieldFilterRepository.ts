import {
  and,
  eq,
  exists,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { fieldValue } from "@/db/schema";
import { records } from "@/server/features/fields/repositories/FieldValueRepository";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldFilter } from "@/types/schemas/fields";

// What a list's filters on custom fields add to its query; what they count
// is FieldFacetRepository's.

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
 * for one field filter: an EXISTS over the record's value row. Null when the filter doesn't fit the field's type.
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

export const FieldFilterRepository = { filterCondition };
