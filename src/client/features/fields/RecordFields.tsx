import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import {
  entityFieldsKey,
  recordFieldsQueryOptions,
  recordListsKey,
} from "@/client/features/fields/fieldQueries";
import { InlineFieldValue } from "@/client/features/fields/FieldValue";
import {
  PROPERTY_LABEL,
  PROPERTY_ROW,
} from "@/client/features/records/InlineField";
import type { RecordField } from "@/server/features/fields/services/fieldShape";
import { setRecordFieldValues } from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FieldValueJson } from "@/shared/fields";

/**
 * A Details section's actions: "Show empty fields", only while there is one
 * to show (a blank property of the record's own, `hasBlank`, or a custom
 * field with no value), and the cog that opens the fields sheet.
 */
export function DetailsActions({
  entity,
  recordId,
  hasBlank = false,
  showEmpty,
  onShowEmpty,
}: {
  entity: FieldEntity;
  recordId: string;
  hasBlank?: boolean;
  showEmpty: boolean;
  onShowEmpty: (show: boolean) => void;
}) {
  const query = useQuery(recordFieldsQueryOptions(entity, recordId));
  const hasEmptyField = (query.data ?? []).some(
    (field) => field.showOnSheet && field.value === null,
  );
  return (
    <div className="flex items-center gap-1">
      {showEmpty || hasBlank || hasEmptyField ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onShowEmpty(!showEmpty)}
        >
          {showEmpty ? "Hide empty fields" : "Show empty fields"}
        </Button>
      ) : null}
      <FieldsSheetButton entity={entity} />
    </div>
  );
}

/**
 * A record sheet's custom fields, under its built-in properties and on their
 * label column: each field shown on sheets, in the order the fields sheet
 * sets, editable in place by anyone. Renders nothing while they load (a row
 * hovered in a list has them by the click) or when the entity has no such
 * fields.
 */
export function RecordFields({
  entity,
  recordId,
  showEmpty = false,
}: {
  entity: FieldEntity;
  recordId: string;
  showEmpty?: boolean;
}) {
  const query = useQuery(recordFieldsQueryOptions(entity, recordId));

  if (query.isPending) return null;
  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        fallback="The custom fields could not be loaded."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
        variant="inline"
      />
    );
  }

  const fields = query.data.filter(
    (field) => field.showOnSheet && (showEmpty || field.value !== null),
  );
  if (fields.length === 0) return null;
  return (
    <dl className="space-y-0.5">
      {fields.map((field) => (
        <RecordFieldRow
          key={field.id}
          entity={entity}
          recordId={recordId}
          field={field}
        />
      ))}
    </dl>
  );
}

function RecordFieldRow({
  entity,
  recordId,
  field,
}: {
  entity: FieldEntity;
  recordId: string;
  field: RecordField;
}) {
  const labelId = useId();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: FieldValueJson) =>
      setRecordFieldValues({
        data: { entity, recordId, values: { [field.key]: value } },
      }),
    // Stays pending until the record reads back, so the new value never
    // flickers to the old one. The list behind the sheet, whose columns may
    // show the value, refetches without holding it up.
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: recordListsKey(entity),
      });
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: recordFieldsQueryOptions(entity, recordId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: [...entityFieldsKey(entity), "coverage"],
        }),
      ]);
    },
  });

  return (
    <div className={`${PROPERTY_ROW} items-center`}>
      <dt id={labelId} className={PROPERTY_LABEL}>
        {field.label}
      </dt>
      <dd className="min-w-0">
        <InlineFieldValue
          field={field}
          value={save.isPending ? save.variables : field.value}
          saving={save.isPending}
          onSave={(value) => save.mutate(value)}
          labelId={labelId}
        />
      </dd>
    </div>
  );
}
