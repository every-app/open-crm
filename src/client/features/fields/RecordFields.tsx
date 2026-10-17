import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  entityFieldsKey,
  recordFieldsQueryOptions,
  recordListsKey,
} from "@/client/features/fields/fieldQueries";
import { InlineFieldValue } from "@/client/features/fields/FieldValue";
import type { RecordField } from "@/server/features/fields/services/fieldShape";
import { setRecordFieldValues } from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FieldValueJson } from "@/shared/fields";

/**
 * The custom fields section of a record sheet: each field shown on sheets,
 * in the order the fields sheet sets, editable in place by anyone. Renders
 * nothing when the entity has no such fields.
 */
export function RecordFields({
  entity,
  recordId,
}: {
  entity: FieldEntity;
  recordId: string;
}) {
  const query = useQuery(recordFieldsQueryOptions(entity, recordId));

  if (query.isPending) {
    return (
      <div className="space-y-2 py-1" aria-busy>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    );
  }
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

  const fields = query.data.filter((field) => field.showOnSheet);
  if (fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-x-3 text-sm">
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
    <>
      <dt id={labelId} className="truncate py-1.5 text-muted-foreground">
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
    </>
  );
}
