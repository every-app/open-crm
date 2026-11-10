import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { DueBadge } from "@/client/features/lists/listColumns";
import { LIST_DOT } from "@/client/features/lists/listColors";
import {
  listsQueryOptions,
  recordListsQueryOptions,
} from "@/client/features/lists/listQueries";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  addToList,
  removeFromList,
  setListStage,
} from "@/serverFunctions/lists";
import type { ListEntity } from "@/shared/crm-enums";
import { NO_STAGE } from "@/types/schemas/records";

type Props = { entity: ListEntity; recordId: string };

/**
 * A contact's or company's sheet: the lists they're in, each with their
 * stage there (changed in place, which files a line on the timeline), and
 * a way into another list. Nothing for a record in no list: AddToFirstList
 * is its way into one.
 */
export function RecordListsSection({ entity, recordId }: Props) {
  const invalidate = useInvalidateRecords();
  const memberships = useQuery(recordListsQueryOptions(entity, recordId));
  const settle = () => invalidate();
  const move = useMutation({
    mutationFn: (input: { listId: string; stageId: string | null }) =>
      setListStage({ data: { ...input, ids: [recordId] } }),
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: (listId: string) =>
      removeFromList({ data: { listId, ids: [recordId] } }),
    onSuccess: settle,
  });
  if (!memberships.data?.length) return null;

  return (
    <SheetSection
      title="Lists"
      action={<AddToListMenu entity={entity} recordId={recordId} align="end" />}
    >
      <ul className="space-y-1">
        {memberships.data.map((membership) => {
          const items = [
            ...membership.stages.map((stage) => ({
              value: stage.id,
              label: stage.name,
            })),
            { value: NO_STAGE, label: "No stage" },
          ];
          return (
            <li
              key={membership.entryId}
              className="flex min-h-8 items-center gap-2 text-sm"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  LIST_DOT[membership.list.color],
                )}
              />
              <Link
                to={entity === "CONTACT" ? "/contacts" : "/companies"}
                search={{ list: membership.list.id }}
                className="min-w-0 truncate hover:underline"
              >
                {membership.list.name}
              </Link>
              {membership.due ? <DueBadge /> : null}
              <span className="ml-auto" />
              {membership.stages.length > 0 ? (
                <Select
                  items={items}
                  value={membership.stage?.id ?? NO_STAGE}
                  disabled={move.isPending}
                  onValueChange={(value) => {
                    if (value !== null)
                      move.mutate({
                        listId: membership.list.id,
                        stageId: value === NO_STAGE ? null : value,
                      });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Stage in ${membership.list.name}`}
                    className="h-7 w-40"
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
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove from ${membership.list.name}`}
                className="text-muted-foreground"
                disabled={remove.isPending}
                onClick={() => remove.mutate(membership.list.id)}
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
    </SheetSection>
  );
}

/**
 * The lists the record isn't in yet, as a menu: a pick adds it. `align` is
 * the side of the button the menu lines up on.
 */
function AddToListMenu({
  entity,
  recordId,
  align,
}: Props & { align: "start" | "end" }) {
  const invalidate = useInvalidateRecords();
  const memberships = useQuery(recordListsQueryOptions(entity, recordId));
  const lists = useQuery(listsQueryOptions());
  const inLists = new Set(
    memberships.data?.map((membership) => membership.list.id),
  );
  const addable = (lists.data ?? []).filter(
    (list) => list.entity === entity && !inLists.has(list.id),
  );
  const add = useMutation({
    mutationFn: (listId: string) =>
      addToList({ data: { listId, ids: [recordId] } }),
    onSuccess: () => invalidate(),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" pending={add.isPending} />}
      >
        <Plus data-icon="inline-start" />
        Add to list
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-72 w-52">
        {addable.length === 0 ? (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            {lists.data?.some((list) => list.entity === entity)
              ? "Already in every list."
              : "No lists yet: make one with + in the sidebar."}
          </DropdownMenuLabel>
        ) : (
          addable.map((list) => (
            <DropdownMenuItem key={list.id} onClick={() => add.mutate(list.id)}>
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  LIST_DOT[list.color],
                )}
              />
              <span className="truncate">{list.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Add to list" for a record in no list, among its sheet's quiet adds: once
 * it is in one, its Lists section has the menu.
 */
export function AddToFirstList({ entity, recordId }: Props) {
  const memberships = useQuery(recordListsQueryOptions(entity, recordId));
  return memberships.data?.length === 0 ? (
    <AddToListMenu entity={entity} recordId={recordId} align="start" />
  ) : null;
}
