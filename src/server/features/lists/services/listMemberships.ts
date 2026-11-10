import { ListEntryRepository } from "@/server/features/lists/repositories/ListEntryRepository";
import { ListRepository } from "@/server/features/lists/repositories/ListRepository";
import type { ListEntity, StageKind } from "@/shared/crm-enums";
import type { ListColor } from "@/types/schemas/lists";

// Which lists a contact or company is in, and at which stage: a sheet's
// Lists and the chips on the contacts and companies tables.

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written through LIST_COLORS only
const colorOf = (value: string) => value as ListColor;

type ListMembership = {
  entryId: string;
  list: {
    id: string;
    name: string;
    color: ListColor;
    followUpDays: number | null;
  };
  stage: { id: string; name: string; kind: StageKind } | null;
  /** The list's stages, to move them with. */
  stages: { id: string; name: string; kind: StageKind }[];
  due: boolean;
  addedAt: string;
};

/** The live lists each of `ids` is in, with its stage there, by record id. */
export async function membershipsOf(
  organizationId: string,
  entity: ListEntity,
  ids: string[],
): Promise<Map<string, ListMembership[]>> {
  if (ids.length === 0) return new Map();
  const found = await ListEntryRepository.membershipsOf(
    organizationId,
    entity,
    ids,
  );
  const listIds = [
    ...new Set([...found.values()].flat().map((entry) => entry.listId)),
  ];
  const [lists, stages] = await Promise.all([
    Promise.all(
      listIds.map((id) => ListRepository.findById(organizationId, id)),
    ),
    ListRepository.stagesOf(organizationId, listIds),
  ]);
  const byId = new Map(
    lists.flatMap((list) => (list ? [[list.id, list] as const] : [])),
  );
  const stagesOf = (listId: string) =>
    stages
      .filter((stage) => stage.listId === listId)
      .map(({ id, name, kind }) => ({ id, name, kind }));
  const memberships = new Map<string, ListMembership[]>();
  for (const [recordId, entries] of found) {
    memberships.set(
      recordId,
      entries.flatMap((entry) => {
        const list = byId.get(entry.listId);
        if (!list) return [];
        const listStages = stagesOf(list.id);
        return [
          {
            entryId: entry.entryId,
            list: {
              id: list.id,
              name: list.name,
              color: colorOf(list.color),
              followUpDays: list.followUpDays,
            },
            stage:
              listStages.find((stage) => stage.id === entry.stageId) ?? null,
            stages: listStages,
            due: entry.due,
            addedAt: entry.addedAt,
          },
        ];
      }),
    );
  }
  return memberships;
}

/** A row's lists on the contacts and companies tables: a chip each. */
export function listChips(memberships: ListMembership[] | undefined) {
  return (memberships ?? []).map((membership) => ({
    id: membership.list.id,
    name: membership.list.name,
    color: membership.list.color,
    stageId: membership.stage?.id ?? null,
    stage: membership.stage?.name ?? null,
    due: membership.due,
  }));
}

/** One record's lists, for its sheet. */
export async function recordLists(
  organizationId: string,
  entity: ListEntity,
  id: string,
) {
  return (await membershipsOf(organizationId, entity, [id])).get(id) ?? [];
}
