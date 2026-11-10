import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import { savedViewsQueryOptions } from "@/client/features/saved-views/savedViewQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { isEnter } from "@/client/lib/keyboard";
import type { SavedView } from "@/server/features/saved-views/services/SavedViewService";
import {
  createSavedView,
  deleteSavedView,
  updateSavedView,
} from "@/serverFunctions/savedViews";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  SAVED_VIEW_NAME_MAX,
  type SavedViewFilters,
} from "@/types/schemas/saved-views";

// The Views menu's dialogs: saving the list as a view, and renaming,
// sharing or deleting your own.

const NAME_TAKEN = "You already have a view with that name.";

const saveViewSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A view needs a name.")
    .max(SAVED_VIEW_NAME_MAX),
  shared: z.boolean(),
});

export function SaveViewDialog({
  entity,
  filters,
  onSaved,
  onClose,
}: {
  entity: FieldEntity;
  /** The list's state; null when it is too large to save. */
  filters: SavedViewFilters | null;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (values: z.infer<typeof saveViewSchema>) =>
      createSavedView({
        data: {
          entity,
          name: values.name.trim(),
          shared: values.shared,
          filters: filters ?? {},
        },
      }),
    meta: { errorToast: false },
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({
        queryKey: savedViewsQueryOptions(entity).queryKey,
      });
      toast.success("View saved.");
      onSaved(view.id);
      onClose();
    },
  });

  const form = useAppForm({
    defaultValues: { name: "", shared: false },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: saveViewSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await create.mutateAsync(value);
      } catch (error) {
        if (getErrorCode(error) === "CONFLICT") {
          formApi.setErrorMap({ onSubmit: { fields: { name: NAME_TAKEN } } });
        } else {
          toast.error(getStandardErrorMessage(error));
        }
      }
    },
  });

  return (
    <form.AppForm>
      <FormDialog
        title="Save view"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={formId} disabled={!filters}>
              Save
            </form.SubmitButton>
          </>
        }
      >
        <form.Form id={formId} className="space-y-4">
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                maxLength={SAVED_VIEW_NAME_MAX}
                autoFocus
              />
            )}
          </form.AppField>
          <form.AppField name="shared">
            {(field) => <field.SwitchField label="Shared" />}
          </form.AppField>
          {filters ? null : (
            <p className="text-sm text-destructive">
              These filters are too large to save.
            </p>
          )}
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

export function ManageViewsDialog({
  entity,
  views,
  onClose,
}: {
  entity: FieldEntity;
  views: SavedView[];
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="My views"
      onClose={onClose}
      actions={
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      }
    >
      {views.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No views
        </p>
      ) : (
        // The footer's border closes the list.
        <ul className="-mx-4 -mb-4 max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
          {views.map((view) => (
            <ManageViewRow key={view.id} entity={entity} view={view} />
          ))}
        </ul>
      )}
    </FormDialog>
  );
}

function ManageViewRow({
  entity,
  view,
}: {
  entity: FieldEntity;
  view: SavedView;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const settle = () =>
    queryClient.invalidateQueries({
      queryKey: savedViewsQueryOptions(entity).queryKey,
    });
  const update = useMutation({
    mutationFn: (patch: { name?: string; shared?: boolean }) =>
      updateSavedView({ data: { id: view.id, ...patch } }),
    onSuccess: settle,
    onError: (error) =>
      toast.error(
        getErrorCode(error) === "CONFLICT"
          ? NAME_TAKEN
          : getStandardErrorMessage(error),
      ),
  });
  const remove = useMutation({
    mutationFn: () => deleteSavedView({ data: { id: view.id } }),
    onSuccess: settle,
  });

  const rename = () => {
    const next = name?.trim();
    setName(null);
    if (next && next !== view.name) update.mutate({ name: next });
  };

  return (
    <li className="flex items-center gap-2 px-4 py-2 text-sm">
      {name === null ? (
        <>
          <span className="min-w-0 flex-1 truncate">{view.name}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Rename ${view.name}`}
            disabled={update.isPending}
            onClick={() => setName(view.name)}
          >
            <Pencil />
          </Button>
        </>
      ) : (
        <>
          <Input
            aria-label={`New name for ${view.name}`}
            className="h-7 flex-1"
            autoFocus
            maxLength={SAVED_VIEW_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (isEnter(event)) rename();
              if (event.key === "Escape") setName(null);
            }}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Save the name of ${view.name}`}
            onClick={rename}
          >
            <Check />
          </Button>
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch
          size="sm"
          checked={view.shared}
          disabled={update.isPending}
          onCheckedChange={(shared) => update.mutate({ shared })}
        />
        Shared
      </label>
      <InlineConfirm
        label={`Delete ${view.name}`}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}
