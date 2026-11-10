import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { FieldValueDisplay } from "@/client/features/fields/FieldValue";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import { OwnerCell } from "@/client/features/records/cells";
import type { Field } from "@/server/features/fields/services/fieldShape";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldValueJson } from "@/shared/fields";

/** The types whose values are short: a number, yes or no, a choice. */
const SHORT_VALUE_TYPES: readonly FieldType[] = [
  "NUMBER",
  "CHECKBOX",
  "SELECT",
];

/** Someone in a user field, as the owner column shows people. */
function MemberCell({ userId }: { userId: string }) {
  const { data: members } = useQuery(membersQueryOptions());
  if (!members) return null;
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) {
    return <span className="text-muted-foreground">Former member</span>;
  }
  return (
    <OwnerCell
      owner={{
        id: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
      }}
    />
  );
}

function FieldCell({ field, value }: { field: Field; value: FieldValueJson }) {
  if (field.type === "USER" && typeof value === "string") {
    return <MemberCell userId={value} />;
  }
  return <FieldValueDisplay field={field} value={value} className="block" />;
}

/**
 * A list table's custom field columns: one per live field shown on the
 * table (`showOnTable`), in sheet order, after the list's own columns. Each
 * row carries its values under `fields`, as FieldValuesService.tableValues
 * returns them (a select's value is already its option's label).
 */
export function useFieldColumns<
  TRow extends { fields: Record<string, FieldValueJson> },
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
            meta: {
              width: SHORT_VALUE_TYPES.includes(field.type) ? 104 : 136,
            },
            cell: ({ row }) => (
              <FieldCell
                field={field}
                value={row.original.fields[field.key] ?? null}
              />
            ),
          }),
        ),
    [fields],
  );
}
