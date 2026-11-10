import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlarmClock,
  Archive,
  Columns3,
  Pencil,
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/client/components/ui/dropdown-menu";
import { EditListDialog } from "@/client/features/lists/ListDialog";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { deleteList, updateList } from "@/serverFunctions/lists";
import { NO_STAGE } from "@/types/schemas/records";

// A list opened in the contacts or companies page (`?list=`): its title, its
// items in the page's ⋯ menu, its stages as tabs with counts, and the Due
// toggle (its board is ListBoard).

/** The list's title, with its color. */
export function ListTitle({ list }: { list: ListSummary }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className={cn("size-3 shrink-0 rounded-full", LIST_DOT[list.color])}
      />
      {list.name}
    </span>
  );
}

const noun = (list: ListSummary, count: number) =>
  list.entity === "CONTACT"
    ? count === 1
      ? "person"
      : "people"
    : count === 1
      ? "company"
      : "companies";

/** Under the title: what the list is for, in its own words. */
export function ListDescription({ list }: { list: ListSummary }) {
  return list.description;
}

const pageOf = (list: ListSummary) =>
  list.entity === "CONTACT" ? "/contacts" : "/companies";

/**
 * The open list's part of the page's ⋯ menu: edit it and its stages,
 * archive it (with an Undo on the toast), delete it. `items` go in the menu
 * and `dialogs` beside it; both are null with no list open.
 */
export function useListMenu(list: ListSummary | undefined, canDelete: boolean) {
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  // The dialog open, and the list it is open on: the menu outlives the list.
  const [dialog, setDialog] = useState<{
    kind: "edit" | "delete";
    listId: string;
  }>();
  const leave = (from: ListSummary) =>
    void navigate({ to: pageOf(from), search: {} });
  const restore = useMutation({
    mutationFn: (archived: ListSummary) =>
      updateList({ data: { id: archived.id, archived: false } }),
    onSuccess: async (_, archived) => {
      await invalidate();
      void navigate({ to: pageOf(archived), search: { list: archived.id } });
    },
  });
  const archive = useMutation({
    mutationFn: (live: ListSummary) =>
      updateList({ data: { id: live.id, archived: true } }),
    onSuccess: async (_, live) => {
      await invalidate();
      // Undo is the only way back: no screen lists archived lists.
      toast.success(`${live.name} archived.`, {
        duration: 10_000,
        action: { label: "Undo", onClick: () => restore.mutate(live) },
      });
      leave(live);
    },
  });
  const remove = useMutation({
    mutationFn: (gone: ListSummary) => deleteList({ data: { id: gone.id } }),
    onSuccess: async (_, gone) => {
      await invalidate();
      toast.success(`${gone.name} deleted.`);
      leave(gone);
    },
  });
  if (!list) return { items: null, dialogs: null };
  const open = dialog?.listId === list.id ? dialog.kind : undefined;
  return {
    items: (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setDialog({ kind: "edit", listId: list.id })}
        >
          <Pencil />
          Edit list and stages
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => archive.mutate(list)}>
          <Archive />
          Archive list
        </DropdownMenuItem>
        {canDelete ? (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog({ kind: "delete", listId: list.id })}
          >
            <Trash2 />
            Delete list
          </DropdownMenuItem>
        ) : null}
      </>
    ),
    dialogs: (
      <>
        {open === "edit" ? (
          <EditListDialog list={list} onClose={() => setDialog(undefined)} />
        ) : null}
        {open === "delete" ? (
          <ConfirmDialog
            title={`Delete ${list.name}?`}
            confirmLabel="Delete list"
            destructive
            pending={remove.isPending}
            onConfirm={() => remove.mutate(list)}
            onClose={() => setDialog(undefined)}
          >
            The list and everyone's stage in it go. The {noun(list, 2)} stay,
            and so do the stage changes on their timelines.
          </ConfirmDialog>
        ) : null}
      </>
    ),
  };
}

type ListViewMode = "table" | "board";

/**
 * Under the header: the list's stages as tabs (each with how many of the
 * list are at it), the Due toggle, and Table or Board. Nothing for a list
 * with neither stages nor a follow-up.
 */
export function ListBar({
  list,
  stage,
  due,
  view,
  onChange,
}: {
  list: ListSummary;
  /** The stage filter: stage ids, NO_STAGE for none. */
  stage: string[];
  due: boolean;
  view: ListViewMode;
  onChange: (update: {
    stage?: string[];
    listDue?: boolean;
    view?: "board";
  }) => void;
}) {
  const hasStages = list.stages.length > 0;
  if (!hasStages && !list.followUpDays) return null;
  const tabs = [
    ...list.stages.map((item) => ({
      id: item.id,
      name: item.name,
      count: item.count,
    })),
    ...(list.noStage > 0
      ? [{ id: NO_STAGE, name: "No stage", count: list.noStage }]
      : []),
  ];
  const tabClass =
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasStages && view === "table" ? (
        // On a phone the tabs take a row of their own, above Due and the view.
        <div
          role="tablist"
          aria-label="Stages"
          className="flex w-full min-w-0 gap-1 overflow-x-auto sm:w-auto sm:flex-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={stage.length === 0}
            className={cn(
              tabClass,
              stage.length === 0
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
            onClick={() => onChange({ stage: undefined })}
          >
            All
            <span className="text-xs text-muted-foreground tabular-nums">
              {list.total}
            </span>
          </button>
          {tabs.map((tab) => {
            const active = stage.length === 1 && stage[0] === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  tabClass,
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
                onClick={() =>
                  onChange({ stage: active ? undefined : [tab.id] })
                }
              >
                {tab.name}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {list.followUpDays ? (
          <Button
            variant={due ? "default" : "outline"}
            size="sm"
            aria-pressed={due}
            onClick={() => onChange({ listDue: due ? undefined : true })}
          >
            <AlarmClock data-icon="inline-start" />
            Due
            <span
              className={cn("tabular-nums", due ? "" : "text-muted-foreground")}
            >
              {list.due}
            </span>
          </Button>
        ) : null}
        {hasStages ? (
          <SegmentedToggle<ListViewMode>
            showLabels
            value={view}
            onChange={(next) =>
              onChange({
                view: next === "board" ? "board" : undefined,
                stage: undefined,
              })
            }
            items={[
              {
                value: "table",
                label: "Table",
                icon: <Table2 className="size-3.5" />,
              },
              {
                value: "board",
                label: "Board",
                icon: <Columns3 className="size-3.5" />,
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}
