import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  listKeys,
  listsQueryOptions,
} from "@/client/features/lists/listQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";
import { createList } from "@/serverFunctions/lists";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  LIST_NAME_MAX,
  LIST_TEMPLATES,
  type ListTemplate,
} from "@/types/schemas/lists";

// The import's last choice, for contacts and companies: the list the rows
// land in (none, one of theirs, or a new one) and the stage they start at.

const NO_LIST = "__none__";
const NEW_LIST = "__new__";
const NO_STAGE = "__none__";

/**
 * The list imported contacts or companies land in: none, one of the
 * entity's lists, or a new one made from a template, each at a stage
 * (by name: a list's stage names are unique) or none.
 */
type ListPick =
  | { kind: "none" }
  | { kind: "existing"; listId: string; stage: string | null }
  | { kind: "new"; name: string; template: ListTemplate; stage: string | null };

const TEMPLATE_LABELS: Record<ListTemplate, string> = {
  PLAIN: "Plain (no stages)",
  OUTREACH: "Outreach",
  NETWORKING: "Networking",
};

/** Where an import's rows land: a list, at a stage or none. */
export type Landing = { listId: string; stageId: string | null };

/**
 * The import's list choice, and where its rows land: the list (made now
 * when it's new) and the starting stage's id, or null for no list.
 * `stageColumn`: a column of the file names each row's own stage.
 */
export function useImportList(entity: FieldEntity, stageColumn: boolean) {
  const queryClient = useQueryClient();
  const listEntity = entity === "DEAL" ? null : entity;
  const lists = useQuery({
    ...listsQueryOptions(),
    enabled: listEntity !== null,
    select: (all) => all.filter((list) => list.entity === listEntity),
  });
  // An import started with a list open lands in it, until another is picked.
  const openListId = useLocation({
    select: (location) => location.search.list,
  });
  const openList = lists.data?.find((list) => list.id === openListId);
  const [picked, setPick] = useState<ListPick>();
  const pick: ListPick =
    picked ??
    (openList
      ? {
          kind: "existing",
          listId: openList.id,
          stage: openList.stages[0]?.name ?? null,
        }
      : { kind: "none" });

  const pickedList =
    pick.kind === "existing"
      ? lists.data?.find((candidate) => candidate.id === pick.listId)
      : undefined;
  const landingIn = (list: ListSummary): Landing => ({
    listId: list.id,
    stageId:
      pick.kind === "none"
        ? null
        : (list.stages.find((stage) => stage.name === pick.stage)?.id ?? null),
  });

  /** Made once: an import started again finds the new list made. */
  const landing = async (): Promise<Landing | null> => {
    if (pick.kind === "none" || !listEntity) return null;
    const list =
      pick.kind === "new"
        ? await createList({
            data: {
              entity: listEntity,
              name: pick.name,
              template: pick.template,
            },
          })
        : pickedList;
    if (!list) return null;
    if (pick.kind === "new") {
      setPick({ kind: "existing", listId: list.id, stage: pick.stage });
      await queryClient.invalidateQueries({ queryKey: listKeys.all });
    }
    return landingIn(list);
  };

  return {
    /** Null for deals, which no list holds. */
    choice:
      listEntity === null ? null : (
        <ListChoice
          lists={lists.data ?? []}
          value={pick}
          onChange={setPick}
          stageColumn={stageColumn}
        />
      ),
    /** A new list still needs its name. */
    unnamed: pick.kind === "new" && !pick.name.trim(),
    landing,
    /** Where the rows land when the list exists already, for the preview. */
    existing: pickedList ? landingIn(pickedList) : null,
  };
}

/** Where the imported records go: a list and a starting stage, or none. */
function ListChoice({
  lists,
  value,
  onChange,
  stageColumn,
}: {
  /** The lists of the entity being imported. */
  lists: ListSummary[];
  value: ListPick;
  onChange: (value: ListPick) => void;
  stageColumn: boolean;
}) {
  const listItems = [
    { value: NO_LIST, label: "None" },
    ...lists.map((list) => ({ value: list.id, label: list.name })),
    { value: NEW_LIST, label: "New list…" },
  ];
  const stageNames =
    value.kind === "existing"
      ? (lists
          .find((list) => list.id === value.listId)
          ?.stages.map((stage) => stage.name) ?? [])
      : value.kind === "new"
        ? LIST_TEMPLATES[value.template].map((stage) => stage.name)
        : [];
  const stageItems = [
    ...stageNames.map((name) => ({ value: name, label: name })),
    { value: NO_STAGE, label: "No stage" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Add to a list</legend>
      <p className="text-xs text-muted-foreground">
        Every row added or updated goes in
        {stageColumn
          ? ", at its Stage column's stage, or the starting stage when that is blank"
          : null}
        . Anyone already in the list keeps their stage.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          items={listItems}
          value={
            value.kind === "existing"
              ? value.listId
              : value.kind === "new"
                ? NEW_LIST
                : NO_LIST
          }
          onValueChange={(next) => {
            if (!next || next === NO_LIST) onChange({ kind: "none" });
            else if (next === NEW_LIST)
              onChange({
                kind: "new",
                name: "",
                template: "PLAIN",
                stage: null,
              });
            else
              onChange({
                kind: "existing",
                listId: next,
                stage:
                  lists.find((list) => list.id === next)?.stages[0]?.name ??
                  null,
              });
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-label="List">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {listItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.kind === "new" ? (
          <Input
            aria-label="New list's name"
            placeholder="List name"
            maxLength={LIST_NAME_MAX}
            value={value.name}
            onChange={(event) =>
              onChange({ ...value, name: event.target.value })
            }
          />
        ) : null}
        {value.kind === "new" ? (
          <Select
            items={Object.entries(TEMPLATE_LABELS).map(([key, label]) => ({
              value: key,
              label,
            }))}
            value={value.template}
            onValueChange={(next) => {
              const template =
                next === "OUTREACH" || next === "NETWORKING" ? next : "PLAIN";
              onChange({
                ...value,
                template,
                stage: LIST_TEMPLATES[template][0]?.name ?? null,
              });
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Stages">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {value.kind !== "none" && stageNames.length > 0 ? (
          <div className="col-span-full flex items-center gap-2 text-sm">
            <span>Starting stage</span>
            <Select
              items={stageItems}
              value={value.stage ?? NO_STAGE}
              onValueChange={(next) =>
                onChange({
                  ...value,
                  stage: !next || next === NO_STAGE ? null : next,
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-48"
                aria-label="Starting stage"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
