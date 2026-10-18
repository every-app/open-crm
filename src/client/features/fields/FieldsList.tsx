import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { RowActionsMenu } from "@/client/components/RowActionsMenu";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import {
  fieldsQueryOptions,
  settleEntityFields,
} from "@/client/features/fields/fieldQueries";
import {
  ArchivedFields,
  DisclosureRow,
  SuggestedFields,
} from "@/client/features/fields/FieldsListSections";
import {
  SortableItem,
  SortableList,
} from "@/client/features/fields/SortableList";
import {
  CUSTOM_GROUP,
  EMPTY_TITLE,
  ERROR_BODY,
  ERROR_TITLE,
  FILTER_NOTE,
  MANAGE_HINT,
  MANUAL_ONLY,
  NEW_FIELD,
  STANDARD_FIELDS,
  STANDARD_ROW,
  TABLE_NOTE,
} from "@/client/features/fields/fieldsCopy";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { Field } from "@/server/features/fields/services/fieldShape";
import { archiveField, reorderFields } from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";

const ROW = "flex items-center gap-2.5 border-b px-4 py-2";

function summaryOf(field: Field): string {
  const parts: string[] = [];
  if (!field.agentFilled) {
    parts.push(field.required ? `${MANUAL_ONLY} · required` : MANUAL_ONLY);
  } else if (field.agentBrief) {
    parts.push(field.agentBrief);
  } else if (field.options.length > 0) {
    parts.push(`${field.options.length} options`);
  }
  if (field.showOnTable) parts.push(TABLE_NOTE);
  if (field.showOnFilter) parts.push(FILTER_NOTE);
  return parts.join(" · ");
}

/** `fields` with the live ones in the order of `ids`, for an optimistic reorder. */
function reordered(fields: Field[], ids: string[]): Field[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const live = ids.flatMap((id) => {
    const field = byId.get(id);
    return field ? [field] : [];
  });
  return [...live, ...fields.filter((field) => field.archived)];
}

/**
 * The fields sheet's list: the entity's standard fields, suggestions, its
 * custom fields in sheet order, and the archived ones. Owners and admins
 * reorder, archive, restore and delete here; everyone else reads.
 */
export function FieldsList({
  entity,
  query,
  canManage,
  onEdit,
  onNew,
}: {
  entity: FieldEntity;
  query: UseQueryResult<Field[]>;
  canManage: boolean;
  onEdit: (id: string) => void;
  onNew: () => void;
}) {
  const queryClient = useQueryClient();
  const listKey = fieldsQueryOptions(entity, true).queryKey;
  const settle = () => settleEntityFields(queryClient, entity);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderFields({ data: { entity, ids } }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData(listKey);
      if (previous) queryClient.setQueryData(listKey, reordered(previous, ids));
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(listKey, context.previous);
      toast.error(getStandardErrorMessage(error));
    },
    onSettled: settle,
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveField({ data: { id } }),
    onSuccess: settle,
  });
  const all = query.data ?? [];
  const live = all.filter((field) => !field.archived);
  const archived = all.filter((field) => field.archived);
  const rows = live.map((field) => {
    const content = (
      <FieldRow
        field={field}
        canManage={canManage}
        onEdit={() => onEdit(field.id)}
        onArchive={() => archive.mutate(field.id)}
      />
    );
    return canManage ? (
      <SortableItem
        key={field.id}
        id={field.id}
        label={field.label}
        className={ROW}
      >
        {content}
      </SortableItem>
    ) : (
      <li key={field.id} className={ROW}>
        {content}
      </li>
    );
  });

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <DisclosureRow
          title={STANDARD_ROW}
          note={String(STANDARD_FIELDS[entity].length)}
        >
          <ul className="border-b bg-muted/40 py-1">
            {STANDARD_FIELDS[entity].map((name) => (
              <li
                key={name}
                className="px-4 py-1 text-xs text-muted-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
        </DisclosureRow>

        {canManage && query.isSuccess ? (
          <SuggestedFields entity={entity} fields={all} onAdded={settle} />
        ) : null}

        {query.isPending ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Spinner />
          </div>
        ) : query.isError ? (
          <div className="p-4">
            <QueryError
              title={ERROR_TITLE}
              error={query.error}
              fallback={ERROR_BODY}
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          </div>
        ) : live.length === 0 ? (
          <div className="p-4">
            <EmptyState
              variant="plain"
              size="sm"
              icon={Plus}
              title={EMPTY_TITLE}
              action={
                canManage ? (
                  <Button onClick={onNew}>
                    <Plus data-icon="inline-start" />
                    {NEW_FIELD}
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <section aria-label={CUSTOM_GROUP}>
            <div className="space-y-1 px-4 pt-3.5 pb-2">
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {CUSTOM_GROUP}
              </p>
              {canManage ? null : (
                <p className="text-xs text-muted-foreground">{MANAGE_HINT}</p>
              )}
            </div>
            {canManage ? (
              <SortableList
                ids={live.map((field) => field.id)}
                onReorder={(ids) => reorder.mutate(ids)}
              >
                <ul>{rows}</ul>
              </SortableList>
            ) : (
              <ul>{rows}</ul>
            )}
          </section>
        )}

        <ArchivedFields
          entity={entity}
          fields={archived}
          canManage={canManage}
          onChanged={settle}
        />
      </div>

      {canManage && live.length > 0 ? (
        <div className="flex shrink-0 items-center border-t p-4">
          <Button onClick={onNew}>
            <Plus data-icon="inline-start" />
            {NEW_FIELD}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** A custom field's row: its label and summary, type, and actions. */
function FieldRow({
  field,
  canManage,
  onEdit,
  onArchive,
}: {
  field: Field;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const summary = summaryOf(field);
  const text = (
    <>
      <span className="block truncate text-sm font-medium">{field.label}</span>
      {summary ? (
        <span className="block truncate text-xs text-muted-foreground">
          {summary}
        </span>
      ) : null}
    </>
  );
  return (
    <>
      {canManage ? (
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onEdit}
        >
          {text}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{text}</div>
      )}
      <Badge variant="outline" className="w-20 shrink-0">
        {field.typeLabel}
      </Badge>
      {canManage ? (
        <RowActionsMenu label={`Actions for ${field.label}`}>
          <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive}>Archive</DropdownMenuItem>
        </RowActionsMenu>
      ) : null}
    </>
  );
}
