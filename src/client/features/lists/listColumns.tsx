import type { ColumnDef } from "@tanstack/react-table";
import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { EmptyValue } from "@/client/features/records/cells";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { setListStage } from "@/serverFunctions/lists";
import type { ListColor } from "@/types/schemas/lists";
import { NO_STAGE } from "@/types/schemas/records";

/** A row's list, as the contacts and companies lists return it. */
type ListChip = {
  id: string;
  name: string;
  color: ListColor;
  stageId: string | null;
  stage: string | null;
  due: boolean;
};

type RowWithLists = { id: string; lists: ListChip[] };

/** A list's name with its color, and its stage there when it has one. */
function ListChipBadge({
  chip,
  showStage = true,
}: {
  chip: ListChip;
  showStage?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", LIST_DOT[chip.color])}
      />
      <span className="truncate">
        {chip.name}
        {showStage && chip.stage ? (
          <span className="text-muted-foreground"> · {chip.stage}</span>
        ) : null}
      </span>
    </span>
  );
}

export function DueBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
      Due
    </span>
  );
}

/** The Lists column: the other lists a row is in (the one shown isn't repeated). */
export function listsColumn<TRow extends RowWithLists>(
  openListId: string | undefined,
): ColumnDef<TRow> {
  return {
    id: "lists",
    header: "Lists",
    enableSorting: false,
    meta: { label: "Lists", width: 220 },
    cell: ({ row }) => {
      const chips = row.original.lists.filter((chip) => chip.id !== openListId);
      if (chips.length === 0) return <EmptyValue />;
      return (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {chips.map((chip) => (
            <ListChipBadge key={chip.id} chip={chip} />
          ))}
        </span>
      );
    },
  };
}

/** The Stage column of a list with stages: each row's stage, changed in place. */
export function stageColumn<TRow extends RowWithLists>(
  list: ListSummary,
): ColumnDef<TRow> {
  return {
    id: "stage",
    header: "Stage",
    enableSorting: false,
    meta: { label: "Stage", width: 180 },
    cell: ({ row }) => {
      const chip = row.original.lists.find(
        (candidate) => candidate.id === list.id,
      );
      return chip ? (
        <StageCell list={list} recordId={row.original.id} chip={chip} />
      ) : (
        <EmptyValue />
      );
    },
  };
}

function StageCell({
  list,
  recordId,
  chip,
}: {
  list: ListSummary;
  recordId: string;
  chip: ListChip;
}) {
  const invalidate = useInvalidateRecords();
  const move = useMutation({
    mutationFn: (stageId: string | null) =>
      setListStage({ data: { listId: list.id, ids: [recordId], stageId } }),
    onSuccess: () => invalidate(),
  });
  const items = [
    ...list.stages.map((stage) => ({ value: stage.id, label: stage.name })),
    { value: NO_STAGE, label: "No stage" },
  ];
  return (
    // The row opens its sheet on a click; the stage picker is its own.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- only stops the row's click
    <div
      className="flex items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <Select
        items={items}
        value={chip.stageId ?? NO_STAGE}
        disabled={move.isPending}
        onValueChange={(value) => {
          if (value !== null) move.mutate(value === NO_STAGE ? null : value);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Stage"
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 shadow-none hover:border-border"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chip.due ? <DueBadge /> : null}
    </div>
  );
}
