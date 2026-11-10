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
function ListChipBadge({ chip }: { chip: ListChip }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", LIST_DOT[chip.color])}
      />
      <span className="truncate">
        {chip.name}
        {chip.stage ? (
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

/**
 * The Lists column of the contacts and companies pages: the first list a
 * row is in, and how many more.
 */
export function listsColumn<TRow extends RowWithLists>(): ColumnDef<TRow> {
  return {
    id: "lists",
    header: "Lists",
    enableSorting: false,
    meta: { label: "Lists", width: 190 },
    cell: ({ row }) => {
      const [first, ...more] = row.original.lists;
      if (!first) return <EmptyValue />;
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <ListChipBadge chip={first} />
          {more.length > 0 ? (
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              title={more.map((chip) => chip.name).join(", ")}
            >
              +{more.length}
            </span>
          ) : null}
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
    // Room for the stage's name, and the Due badge in a list that follows up.
    meta: { label: "Stage", width: list.followUpDays ? 180 : 152 },
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
  // The stage picked shows at once, while the move and the refetch run. The
  // picker waits for them: a second pick before then could lose to the first.
  const stageId = move.isPending ? move.variables : chip.stageId;
  return (
    // The row opens its sheet on a click; the stage picker is its own.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- only stops the row's click
    <div
      className="flex items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <Select
        items={items}
        value={stageId ?? NO_STAGE}
        disabled={move.isPending}
        onValueChange={(value) => {
          if (value !== null) move.mutate(value === NO_STAGE ? null : value);
        }}
      >
        {/* As wide as its stage's name, so the Due badge moves no chevron. */}
        <SelectTrigger
          size="sm"
          aria-label="Stage"
          className="h-7 min-w-0 border-transparent bg-transparent px-2 shadow-none hover:border-border"
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
