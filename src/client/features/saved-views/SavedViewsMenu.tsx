import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Bookmark, Check, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import { savedViewsQueryOptions } from "@/client/features/saved-views/savedViewQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import type { SavedView } from "@/server/features/saved-views/services/SavedViewService";
import {
  createSavedView,
  deleteSavedView,
  updateSavedView,
} from "@/serverFunctions/savedViews";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  SAVED_VIEW_NAME_MAX,
  savedViewFiltersSchema,
  type SavedViewFilters,
} from "@/types/schemas/saved-views";

const NAME_TAKEN = "You already have a view with that name.";

/**
 * The "Views" menu of a list toolbar: save the list's current filters under
 * a name (for yourself or the team), apply a view, and rename, share,
 * unshare or delete your own. The list passes its filter state as it keeps
 * it (any JSON-serializable object, such as its search params without the
 * page) and gets a saved one back to apply, which it should validate with
 * its own schema: a view outlives the shape it was saved in.
 */
export function SavedViewsMenu({
  entity,
  current,
  onApply,
}: {
  entity: FieldEntity;
  current: Record<string, unknown>;
  onApply: (filters: SavedViewFilters) => void;
}) {
  const views = useQuery(savedViewsQueryOptions(entity));
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const mine = views.data?.filter((view) => view.mine) ?? [];
  const team = views.data?.filter((view) => !view.mine) ?? [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <Bookmark data-icon="inline-start" />
          Views
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto max-w-80 min-w-56">
          <DropdownMenuItem onClick={() => setDialog("save")}>
            Save current view…
          </DropdownMenuItem>
          {views.isPending ? (
            <DropdownMenuItem disabled>Loading views…</DropdownMenuItem>
          ) : null}
          {views.isError ? (
            <DropdownMenuItem disabled>
              Views could not be loaded
            </DropdownMenuItem>
          ) : null}
          {mine.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>My views</DropdownMenuLabel>
                {mine.map((view) => (
                  <DropdownMenuItem
                    key={view.id}
                    onClick={() => onApply(view.filters)}
                  >
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    {view.shared ? <Users aria-label="Shared" /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          {team.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Shared with the team</DropdownMenuLabel>
                {team.map((view) => (
                  <DropdownMenuItem
                    key={view.id}
                    onClick={() => onApply(view.filters)}
                  >
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          {mine.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialog("manage")}>
                Manage my views…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "save" ? (
        <SaveViewDialog
          entity={entity}
          current={current}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "manage" ? (
        <ManageViewsDialog
          entity={entity}
          views={mine}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

const saveViewSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A view needs a name.")
    .max(SAVED_VIEW_NAME_MAX),
  shared: z.boolean(),
});

function SaveViewDialog({
  entity,
  current,
  onClose,
}: {
  entity: FieldEntity;
  current: Record<string, unknown>;
  onClose: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  // The state as JSON stores it: what a reload of the view gives back.
  const filters = savedViewFiltersSchema.safeParse(
    JSON.parse(JSON.stringify(current)),
  );
  const create = useMutation({
    mutationFn: (values: z.infer<typeof saveViewSchema>) =>
      createSavedView({
        data: {
          entity,
          name: values.name.trim(),
          shared: values.shared,
          filters: filters.success ? filters.data : {},
        },
      }),
    meta: { errorToast: false },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: savedViewsQueryOptions(entity).queryKey,
      });
      toast.success("View saved");
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
        title="Save this view"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={formId} disabled={!filters.success}>
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
                placeholder="Hot leads in EMEA"
                maxLength={SAVED_VIEW_NAME_MAX}
                autoFocus
              />
            )}
          </form.AppField>
          <form.AppField name="shared">
            {(field) => (
              <field.SwitchField
                label="Share with the team"
                description="Everyone in the workspace can apply it. Only you can change it."
              />
            )}
          </form.AppField>
          {filters.success ? null : (
            <p className="text-sm text-destructive">
              These filters are too large to save.
            </p>
          )}
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}

function ManageViewsDialog({
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
          You have no saved views here.
        </p>
      ) : (
        <ul className="-mx-4 max-h-96 divide-y overflow-y-auto border-y">
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
              if (event.key === "Enter") rename();
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
