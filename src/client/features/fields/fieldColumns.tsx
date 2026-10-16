import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { FieldValueDisplay } from "@/client/features/fields/FieldValue";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FieldValueJson } from "@/shared/fields";

/**
 * A list table's custom field columns: one per field shown on the table
 * (`showOnTable`), in sheet order. Each row carries its values under
 * `fields`, as FieldValuesService.tableValues returns them.
 */
export function useFieldColumns<
  TRow extends { fields?: Record<string, FieldValueJson> },
>(entity: FieldEntity): ColumnDef<TRow>[] {
  const { data: fields } = useQuery(fieldsQueryOptions(entity));
  return useMemo(
    () =>
      (fields ?? [])
        .filter((field) => field.showOnTable)
        .map(
          (field): ColumnDef<TRow> => ({
            id: `field:${field.key}`,
            header: field.label,
            enableSorting: false,
            cell: ({ row }) => (
              <FieldValueDisplay
                field={field}
                value={row.original.fields?.[field.key] ?? null}
              />
            ),
          }),
        ),
    [fields],
  );
}
