import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { fieldCoverageQueryOptions } from "@/client/features/fields/fieldQueries";
import {
  ARCHIVED_ROW,
  SUGGESTED_FIELDS,
  SUGGESTED_ROW,
} from "@/client/features/fields/fieldsCopy";
import type { Field } from "@/server/features/fields/services/fieldShape";
import {
  createField,
  deleteField,
  restoreField,
} from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";
import { FIELD_TYPE_LABELS, fieldKeyFromLabel } from "@/shared/fields";

export function DisclosureRow({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 border-b px-4 py-2.5 text-left hover:bg-muted/50">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className="flex-1 text-xs font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Suggested fields the entity doesn't have yet, one click to add. */
export function SuggestedFields({
  entity,
  fields,
  onAdded,
}: {
  entity: FieldEntity;
  fields: Field[];
  onAdded: () => Promise<void>;
}) {
  const add = useMutation({
    mutationFn: (template: (typeof SUGGESTED_FIELDS)[FieldEntity][number]) =>
      createField({
        data: {
          entity,
          label: template.label,
          type: template.type,
          options: ("options" in template ? template.options : []).map(
            (label) => ({ label }),
          ),
        },
      }),
    onSuccess: onAdded,
  });
  const taken = new Set(fields.map((field) => field.key));
  const suggestions = SUGGESTED_FIELDS[entity].filter(
    (template) => !taken.has(fieldKeyFromLabel(template.label)),
  );
  if (suggestions.length === 0) return null;

  return (
    <DisclosureRow title={SUGGESTED_ROW} note={String(suggestions.length)}>
      <ul className="border-b bg-muted/40 py-1">
        {suggestions.map((template) => (
          <li
            key={template.label}
            className="flex items-center gap-2.5 px-4 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {template.label} ·{" "}
              {"options" in template
                ? template.options.join(", ")
                : FIELD_TYPE_LABELS[template.type]}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={add.isPending}
              onClick={() => add.mutate(template)}
            >
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </li>
        ))}
      </ul>
    </DisclosureRow>
  );
}

/** Archived fields: values kept, hidden everywhere, restored or deleted here. */
export function ArchivedFields({
  entity,
  fields,
  canManage,
  onChanged,
}: {
  entity: FieldEntity;
  fields: Field[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<Field | null>(null);
  const restore = useMutation({
    mutationFn: (id: string) => restoreField({ data: { id } }),
    onSuccess: onChanged,
  });
  if (fields.length === 0) return null;

  return (
    <>
      <DisclosureRow title={ARCHIVED_ROW} note={String(fields.length)}>
        <ul className="border-b">
          {fields.map((field) => (
            <li key={field.id} className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {field.label}
              </span>
              {canManage ? (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(field.id)}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => setDeleting(field)}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </DisclosureRow>
      {deleting ? (
        <DeleteFieldDialog
          entity={entity}
          field={deleting}
          onDeleted={onChanged}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

/** The loud one: a field and every value it holds, gone for good. */
function DeleteFieldDialog({
  entity,
  field,
  onDeleted,
  onClose,
}: {
  entity: FieldEntity;
  field: Field;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}) {
  const coverage = useQuery(fieldCoverageQueryOptions(entity, field.id));
  const remove = useMutation({
    mutationFn: () => deleteField({ data: { id: field.id } }),
    onSuccess: async () => {
      onClose();
      toast.success(`${field.label} deleted.`);
      await onDeleted();
    },
  });
  const values = coverage.data?.values;
  return (
    <ConfirmDialog
      title={`Delete ${field.label} for good?`}
      confirmLabel="Delete field"
      destructive
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {values === undefined
        ? "Every value it holds goes too."
        : `Its ${values} ${values === 1 ? "value goes" : "values go"} too.`}
    </ConfirmDialog>
  );
}
