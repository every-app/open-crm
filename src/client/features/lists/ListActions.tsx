import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, CircleDot, ListMinus, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { listsQueryOptions } from "@/client/features/lists/listQueries";
import { BulkSubmenu } from "@/client/features/records/RecordBulkMenu";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import {
  addMatchingToList,
  addToList,
  removeFromList,
  setListStage,
} from "@/serverFunctions/lists";
import type { ListEntity } from "@/shared/crm-enums";

// What the contacts and companies lists do with lists: put the selected
// rows in one, move them to a stage of the list shown, take them out of it,
// and put everyone the filters match in one.

const plural = (count: number, entity: ListEntity) =>
  `${count.toLocaleString()} ${
    entity === "CONTACT"
      ? count === 1
        ? "person"
        : "people"
      : count === 1
        ? "company"
        : "companies"
  }`;

function ListName({ list }: { list: ListSummary }) {
  return (
    <>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", LIST_DOT[list.color])}
      />
      <span className="truncate">{list.name}</span>
    </>
  );
}

function useEntityLists(entity: ListEntity) {
  const lists = useQuery(listsQueryOptions());
  return (lists.data ?? []).filter((list) => list.entity === entity);
}

/**
 * The bulk menu's list submenus for the selected rows: Add to list, and
 * while a list is shown, Set stage and Remove from it.
 */
export function ListBulkItems({
  entity,
  ids,
  openList,
  onDone,
}: {
  entity: ListEntity;
  ids: string[];
  openList: ListSummary | undefined;
  onDone: () => void;
}) {
  const lists = useEntityLists(entity);
  const invalidate = useInvalidateRecords();
  const settle = async (message: string) => {
    toast.success(message);
    onDone();
    await invalidate();
  };
  const add = useMutation({
    mutationFn: (list: ListSummary) =>
      addToList({ data: { listId: list.id, ids } }),
    onSuccess: (result, list) =>
      settle(
        result.added > 0
          ? `${plural(result.added, entity)} added to ${list.name}.`
          : `Already in ${list.name}.`,
      ),
  });
  const move = useMutation({
    mutationFn: (input: {
      list: ListSummary;
      stageId: string | null;
      name: string;
    }) =>
      setListStage({
        data: { listId: input.list.id, ids, stageId: input.stageId },
      }),
    onSuccess: (result, input) =>
      settle(
        result.moved > 0
          ? `${plural(result.moved, entity)} moved to ${input.name}.`
          : "Nothing moved.",
      ),
  });
  const remove = useMutation({
    mutationFn: (list: ListSummary) =>
      removeFromList({ data: { listId: list.id, ids } }),
    onSuccess: (result, list) =>
      settle(`${plural(result.removed, entity)} removed from ${list.name}.`),
  });

  return (
    <>
      <BulkSubmenu
        icon={ListPlus}
        label="Add to list"
        className="max-h-72 min-w-48"
      >
        {lists.length === 0 ? (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            No lists yet: make one with + in the sidebar.
          </DropdownMenuLabel>
        ) : (
          lists.map((list) => (
            <DropdownMenuItem key={list.id} onClick={() => add.mutate(list)}>
              <ListName list={list} />
            </DropdownMenuItem>
          ))
        )}
      </BulkSubmenu>
      {openList && openList.stages.length > 0 ? (
        <BulkSubmenu
          icon={CircleDot}
          label="Set stage"
          className="max-h-72 min-w-44"
        >
          {openList.stages.map((stage) => (
            <DropdownMenuItem
              key={stage.id}
              onClick={() =>
                move.mutate({
                  list: openList,
                  stageId: stage.id,
                  name: stage.name,
                })
              }
            >
              {stage.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() =>
              move.mutate({ list: openList, stageId: null, name: "no stage" })
            }
          >
            No stage
          </DropdownMenuItem>
        </BulkSubmenu>
      ) : null}
      {openList ? (
        <DropdownMenuItem onClick={() => remove.mutate(openList)}>
          <ListMinus />
          Remove from {openList.name}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/**
 * "Add all to a list": everyone the page's search and filters match (not
 * just one page of selected rows) goes in the list picked.
 */
export function AddMatchingToList({
  entity,
  filters,
  total,
  openListId,
}: {
  entity: ListEntity;
  /** The page's list input, as the server takes it. */
  filters: Record<string, unknown>;
  total: number | undefined;
  openListId: string | undefined;
}) {
  const lists = useEntityLists(entity).filter((list) => list.id !== openListId);
  const invalidate = useInvalidateRecords();
  const add = useMutation({
    mutationFn: (list: ListSummary) =>
      addMatchingToList({ data: { listId: list.id, filters } }),
    onSuccess: async (result, list) => {
      toast.success(
        `${plural(result.added, entity)} added to ${list.name}${
          result.alreadyIn > 0
            ? ` (${result.alreadyIn.toLocaleString()} already in it)`
            : ""
        }.`,
      );
      await invalidate();
    },
  });
  if (lists.length === 0 || !total) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" pending={add.isPending} />}
      >
        <ListPlus data-icon="inline-start" />
        Add {total === 1 ? "it" : `all ${total.toLocaleString()}`} to list
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56">
        {lists.map((list) => (
          <DropdownMenuItem key={list.id} onClick={() => add.mutate(list)}>
            <ListName list={list} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
