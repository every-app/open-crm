import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, ChevronDown, Users } from "lucide-react";
import { cn } from "cn";
import { isDeepEqual } from "remeda";
import { toast } from "sonner";
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
import {
  ManageViewsDialog,
  SaveViewDialog,
} from "@/client/features/saved-views/SavedViewDialogs";
import { savedViewsQueryOptions } from "@/client/features/saved-views/savedViewQueries";
import type { SavedView } from "@/server/features/saved-views/services/SavedViewService";
import { updateSavedView } from "@/serverFunctions/savedViews";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  savedViewFiltersSchema,
  type SavedViewFilters,
} from "@/types/schemas/saved-views";

/**
 * The "Views" menu of a list toolbar: save the list's current filters under
 * a name (for yourself or the team), apply a view, update one of your own
 * to the list as it is now, and rename, share, unshare or delete your own.
 * The list passes its filter state as it keeps it (any JSON-serializable
 * object, such as its search params without the page) and gets a saved one
 * back to apply, which it should validate with its own schema: a view
 * outlives the shape it was saved in.
 *
 * The button is named after the view the list is showing: the one whose
 * filters are the list's own. Saving is offered once the list differs from
 * every view and from its unfiltered self; updating, for the view last
 * applied or saved (`lastViewId`, which the toolbar keeps: the menu
 * unmounts with a phone's "View options" sheet).
 */
export function SavedViewsMenu({
  entity,
  current,
  onApply,
  lastViewId,
  onLastViewChange,
  showLabel = false,
}: {
  entity: FieldEntity;
  current: Record<string, unknown>;
  onApply: (filters: SavedViewFilters) => void;
  lastViewId: string | undefined;
  onLastViewChange: (id: string) => void;
  showLabel?: boolean;
}) {
  const queryClient = useQueryClient();
  const views = useQuery(savedViewsQueryOptions(entity));
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const mine = views.data?.filter((view) => view.mine) ?? [];
  const team = views.data?.filter((view) => !view.mine) ?? [];
  // The state as JSON stores it: what a reload of the view gives back.
  // Null when it is too large to save.
  const parsed = savedViewFiltersSchema.safeParse(
    JSON.parse(JSON.stringify(current)),
  );
  const state = parsed.success ? parsed.data : null;
  const showing = state
    ? (views.data ?? []).filter((view) => isDeepEqual(view.filters, state))
    : [];
  const applied =
    showing.find((view) => view.id === lastViewId) ?? showing.at(0);
  const unsaved = !applied && (!state || Object.keys(state).length > 0);
  const last = unsaved
    ? mine.find((view) => view.id === lastViewId)
    : undefined;

  const update = useMutation({
    mutationFn: (data: { id: string; filters: SavedViewFilters }) =>
      updateSavedView({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: savedViewsQueryOptions(entity).queryKey,
      });
      toast.success("View updated.");
    },
  });

  const viewItem = (view: SavedView) => (
    <DropdownMenuItem
      key={view.id}
      onClick={() => {
        onLastViewChange(view.id);
        onApply(view.filters);
      }}
    >
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      {view.mine && view.shared ? <Users aria-label="Shared" /> : null}
      {view.id === applied?.id ? <Check aria-label="Applied" /> : null}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={applied ? `Views: ${applied.name}` : undefined}
            />
          }
        >
          <Bookmark data-icon="inline-start" />
          <span
            className={cn("max-w-40 truncate", !showLabel && "max-sm:sr-only")}
          >
            {applied?.name ?? "Views"}
          </span>
          <ChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </DropdownMenuTrigger>
        {/* A separator opens each section but the menu's first. */}
        <DropdownMenuContent
          align="end"
          className="w-auto max-w-80 min-w-56 *:data-[slot=dropdown-menu-separator]:first:hidden"
        >
          {last && state ? (
            <DropdownMenuItem
              disabled={update.isPending}
              onClick={() => update.mutate({ id: last.id, filters: state })}
            >
              <span className="min-w-0 truncate">Update {last.name}</span>
            </DropdownMenuItem>
          ) : null}
          {unsaved ? (
            <DropdownMenuItem onClick={() => setDialog("save")}>
              Save view…
            </DropdownMenuItem>
          ) : null}
          {views.isPending ? (
            <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          ) : null}
          {views.isError ? (
            <DropdownMenuItem disabled>Couldn't load views</DropdownMenuItem>
          ) : null}
          {views.data?.length === 0 && !unsaved ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Filter or sort the list to save a view.
            </p>
          ) : null}
          {mine.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>My views</DropdownMenuLabel>
                {mine.map(viewItem)}
              </DropdownMenuGroup>
            </>
          ) : null}
          {team.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Shared</DropdownMenuLabel>
                {team.map(viewItem)}
              </DropdownMenuGroup>
            </>
          ) : null}
          {mine.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialog("manage")}>
                Manage views…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "save" ? (
        <SaveViewDialog
          entity={entity}
          filters={state}
          onSaved={onLastViewChange}
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
