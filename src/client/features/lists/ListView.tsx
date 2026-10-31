import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlarmClock,
  Archive,
  Columns3,
  Settings2,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { EditListDialog } from "@/client/features/lists/ListDialog";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { deleteList, updateList } from "@/serverFunctions/lists";
import { NO_STAGE } from "@/types/schemas/records";

// A list opened in the contacts or companies page (`?list=`): its title and
// menu, its stages as tabs with counts, and the Due toggle (its board is
// ListBoard).

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

/** Under the title: what the list is for, how many are in it, its follow-up. */
export function ListDescription({ list }: { list: ListSummary }) {
  return (
    <>
      {list.description ? `${list.description} · ` : null}
      {list.total.toLocaleString()} {noun(list, list.total)}
      {list.followUpDays
        ? ` · Due after ${list.followUpDays} days quiet`
        : null}
    </>
  );
}

/** The list's ⋯ menu: edit it and its stages, archive it, delete it. */
export function ListMenu({
  list,
  canDelete,
}: {
  list: ListSummary;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const invalidate = useInvalidateRecords();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const leave = () =>
    void navigate({
      to: list.entity === "CONTACT" ? "/contacts" : "/companies",
      search: {},
    });
  const archive = useMutation({
    mutationFn: () => updateList({ data: { id: list.id, archived: true } }),
    onSuccess: async () => {
      await invalidate();
      toast.success(`${list.name} archived.`);
      leave();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteList({ data: { id: list.id } }),
    onSuccess: async () => {
      await invalidate();
      toast.success(`${list.name} deleted.`);
      leave();
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          <Settings2 data-icon="inline-start" />
          List
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil />
            Edit list and stages
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => archive.mutate()}>
            <Archive />
            Archive list
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 />
                Delete list
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? (
        <EditListDialog list={list} onClose={() => setEditing(false)} />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${list.name}?`}
          confirmLabel="Delete list"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        >
          The list and everyone's stage in it go. The {noun(list, 2)} stay, and
          so do the stage changes on their timelines.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

type ListViewMode = "table" | "board";

/**
 * Under the header: the list's stages as tabs (each with how many of the
 * list's search are at it), the Due toggle, and Table or Board.
 */
export function ListBar({
  list,
  stage,
  stageCounts,
  due,
  view,
  onChange,
}: {
  list: ListSummary;
  /** The stage filter: stage ids, NO_STAGE for none. */
  stage: string[];
  stageCounts: Record<string, number> | undefined;
  due: boolean;
  view: ListViewMode;
  onChange: (update: {
    stage?: string[];
    listDue?: boolean;
    view?: "board";
  }) => void;
}) {
  const hasStages = list.stages.length > 0;
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
        <div
          role="tablist"
          aria-label="Stages"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
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
                  {stageCounts?.[tab.id] ?? tab.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1" />
      )}
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
  );
}
