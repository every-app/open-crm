import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { ReactNode } from "react";
import { cn } from "cn";
import { QueryError } from "@/client/components/QueryState";
import { DueBadge } from "@/client/features/lists/listColumns";
import { listEntriesQueryOptions } from "@/client/features/lists/listQueries";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { setListStage } from "@/serverFunctions/lists";
import { NO_STAGE } from "@/types/schemas/records";

/**
 * The list as a board: a column per stage (and "No stage" when anyone is at
 * none), each card a record; dragging a card to a column moves it there.
 */
export function ListBoard({
  list,
  due,
  onOpen,
}: {
  list: ListSummary;
  due: boolean;
  onOpen: (recordId: string) => void;
}) {
  const invalidate = useInvalidateRecords();
  const queryClient = useQueryClient();
  const board = listEntriesQueryOptions({
    listId: list.id,
    stage: [],
    due,
    limit: 500,
  });
  const { queryKey } = board;
  const entries = useQuery(board);
  // One key for this board's moves, to tell when the last has settled.
  const mutationKey = ["lists", "board-move", list.id];
  const setStage = (recordId: string, stageId: string | null) =>
    queryClient.setQueryData(
      queryKey,
      (loaded) =>
        loaded && {
          ...loaded,
          entries: loaded.entries.map((entry) =>
            entry.recordId === recordId ? { ...entry, stageId } : entry,
          ),
        },
    );
  const move = useMutation({
    mutationKey,
    mutationFn: (input: { recordId: string; stageId: string | null }) =>
      setListStage({
        data: {
          listId: list.id,
          ids: [input.recordId],
          stageId: input.stageId,
        },
      }),
    // The card sits in its new column at once, not after the refetch.
    onMutate: async ({ recordId, stageId }) => {
      await queryClient.cancelQueries({ queryKey });
      const from = queryClient
        .getQueryData(queryKey)
        ?.entries.find((entry) => entry.recordId === recordId)?.stageId;
      setStage(recordId, stageId);
      return { from };
    },
    // A move that failed puts its own card back. The board reads the truth
    // once no other move is on its way: a refetch before that would undo
    // the cards still moving. The refetch is not awaited, or this move would
    // still count as on its way and stop the next move's refetch.
    onSettled: (_moved, error, { recordId }, context) => {
      if (error && context?.from !== undefined) {
        setStage(recordId, context.from);
      }
      if (queryClient.isMutating({ mutationKey }) === 1) void invalidate();
    },
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const rows = entries.data?.entries ?? [];
  const known = new Set(list.stages.map((stage) => stage.id));
  const columns = [
    ...list.stages.map((stage) => ({ id: stage.id, name: stage.name })),
    ...(rows.some((row) => !row.stageId || !known.has(row.stageId))
      ? [{ id: NO_STAGE, name: "No stage" }]
      : []),
  ];
  const columnOf = (stageId: string | null) =>
    stageId && known.has(stageId) ? stageId : NO_STAGE;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const row = rows.find((candidate) => candidate.recordId === active.id);
    const to = String(over.id);
    if (!row || columnOf(row.stageId) === to) return;
    move.mutate({
      recordId: row.recordId,
      stageId: to === NO_STAGE ? null : to,
    });
  };

  if (entries.isError) {
    return (
      <QueryError
        error={entries.error}
        fallback="Couldn't load the board."
        onRetry={() => void entries.refetch()}
        isRetrying={entries.isFetching}
      />
    );
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {/*
        The columns scroll sideways when they don't fit. The ::-webkit-scrollbar
        styles make Chrome and Safari draw a classic scrollbar that always
        shows (an overlay one hides until scrolled, so a column past the edge
        looks cut). The app's scrollbar-color (app.css) would turn them off,
        so it is reset here.
      */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3 [scrollbar-color:auto] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        {columns.map((column) => {
          const cards = rows.filter(
            (row) => columnOf(row.stageId) === column.id,
          );
          return (
            <BoardColumn
              key={column.id}
              id={column.id}
              name={column.name}
              count={cards.length}
            >
              {entries.isPending ? (
                <div className="h-16 animate-pulse rounded-lg bg-background/60" />
              ) : (
                cards.map((card) => (
                  <BoardCard
                    key={card.entryId}
                    id={card.recordId}
                    name={card.name}
                    detail={card.detail}
                    lastActivityAt={card.lastActivityAt}
                    due={card.due}
                    onOpen={() => onOpen(card.recordId)}
                  />
                ))
              )}
            </BoardColumn>
          );
        })}
      </div>
      {entries.data && entries.data.total > rows.length ? (
        <p className="text-xs text-muted-foreground">
          Showing the {rows.length} most recently moved of {entries.data.total}.
          The table shows them all.
        </p>
      ) : null}
    </DndContext>
  );
}

function BoardColumn({
  id,
  name,
  count,
  children,
}: {
  id: string;
  name: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={name}
      className={cn(
        "flex w-64 shrink-0 grow flex-col gap-2 rounded-xl bg-muted/60 p-2 transition-colors",
        isOver && "bg-primary/10 ring-2 ring-primary/30",
      )}
    >
      <h3 className="flex items-center gap-1.5 px-1.5 pt-1 text-xs font-semibold">
        {name}
        <span className="font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      </h3>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}

function BoardCard({
  id,
  name,
  detail,
  lastActivityAt,
  due,
  onOpen,
}: {
  id: string;
  name: string;
  detail: string | null;
  lastActivityAt: string | null;
  due: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm shadow-xs transition-shadow hover:border-foreground/20",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <span className="truncate font-medium">{name}</span>
      {detail ? (
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {lastActivityAt ? (
          <RelativeTime date={lastActivityAt} />
        ) : (
          <span>No activity yet</span>
        )}
        {due ? <DueBadge /> : null}
      </span>
    </button>
  );
}
