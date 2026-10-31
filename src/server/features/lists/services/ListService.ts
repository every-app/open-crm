import { ListEntryRepository } from "@/server/features/lists/repositories/ListEntryRepository";
import {
  ListRepository,
  type ListRow,
  type StageRow,
} from "@/server/features/lists/repositories/ListRepository";
import {
  membershipsOf,
  recordLists,
} from "@/server/features/lists/services/listMemberships";
import { listEntries } from "@/server/features/lists/services/listBoard";
import { matchingIds } from "@/server/features/lists/services/listMatching";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { AppError, UserFacingError } from "@/server/lib/errors";
import type { ListEntity, StageKind } from "@/shared/crm-enums";
import {
  LIST_TEMPLATES,
  type AddMatchingToListInput,
  type AddToListInput,
  type CreateListInput,
  type ListColor,
  type RemoveFromListInput,
  type SetListStageInput,
  type SetListStagesInput,
  type UpdateListInput,
} from "@/types/schemas/lists";

// Lists: a context the team works people or companies in ("Backlink
// outreach", "Networking"), with its own stages or none. A record is in a
// list once, at one of its stages; moving it files a line on its timeline.

export type ListStage = {
  id: string;
  name: string;
  kind: StageKind;
  count: number;
};

/** A list as the sidebar, its page and the tools show it. */
export type ListSummary = {
  id: string;
  entity: ListEntity;
  name: string;
  color: ListColor;
  description: string | null;
  followUpDays: number | null;
  archived: boolean;
  stages: ListStage[];
  /** Live records in it. */
  total: number;
  /** Of those, how many are at no stage. */
  noStage: number;
  /** Of those, how many are Due. */
  due: number;
  createdAt: string;
};

const NAME_TAKEN = "There is already a list with that name.";

function notFound(id: string): never {
  throw new AppError("NOT_FOUND", `No list with id ${id}.`);
}

function colorOf(value: string): ListColor {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written through LIST_COLORS only
  return value as ListColor;
}

function summarize(
  row: ListRow,
  stages: StageRow[],
  counts: Awaited<ReturnType<typeof ListRepository.entryCounts>>,
): ListSummary {
  const mine = counts.filter((count) => count.listId === row.id);
  const at = (stageId: string | null) =>
    mine.find((count) => count.stageId === stageId)?.count ?? 0;
  // An entry whose stage was removed counts as at none.
  const known = new Set(stages.map((stage) => stage.id));
  return {
    id: row.id,
    entity: row.entity,
    name: row.name,
    color: colorOf(row.color),
    description: row.description,
    followUpDays: row.followUpDays,
    archived: Boolean(row.archivedAt),
    stages: stages
      .filter((stage) => stage.listId === row.id)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        kind: stage.kind,
        count: at(stage.id),
      })),
    total: mine.reduce((sum, count) => sum + count.count, 0),
    noStage: mine
      .filter((count) => count.stageId === null || !known.has(count.stageId))
      .reduce((sum, count) => sum + count.count, 0),
    due: mine.reduce((sum, count) => sum + count.due, 0),
    createdAt: row.createdAt,
  };
}

async function listLists(
  organizationId: string,
  input: { includeArchived: boolean },
): Promise<ListSummary[]> {
  const [rows, counts] = await Promise.all([
    ListRepository.list(organizationId, input.includeArchived),
    ListRepository.entryCounts(organizationId),
  ]);
  const stages = await ListRepository.stagesOf(
    organizationId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => summarize(row, stages, counts));
}

async function requireList(organizationId: string, id: string) {
  return (await ListRepository.findById(organizationId, id)) ?? notFound(id);
}

async function getList(
  organizationId: string,
  id: string,
): Promise<ListSummary> {
  const row = await requireList(organizationId, id);
  const [stages, counts] = await Promise.all([
    ListRepository.stagesOf(organizationId, [id]),
    ListRepository.entryCounts(organizationId),
  ]);
  return summarize(row, stages, counts);
}

async function createList(
  organizationId: string,
  userId: string | null,
  input: CreateListInput,
): Promise<ListSummary> {
  const id = crypto.randomUUID();
  try {
    await ListRepository.insert(
      {
        id,
        organizationId,
        entity: input.entity,
        name: input.name,
        color: input.color,
        description: input.description || null,
        followUpDays: input.followUpDays ?? null,
        createdById: userId,
      },
      input.stages ?? LIST_TEMPLATES[input.template],
    );
  } catch (error) {
    if (isUniqueViolation(error))
      throw new UserFacingError("CONFLICT", NAME_TAKEN);
    throw error;
  }
  return getList(organizationId, id);
}

async function updateList(
  organizationId: string,
  input: UpdateListInput,
): Promise<ListSummary> {
  const before = await requireList(organizationId, input.id);
  try {
    await ListRepository.update(organizationId, input.id, {
      name: input.name,
      color: input.color,
      description:
        input.description === undefined ? undefined : input.description || null,
      followUpDays: input.followUpDays,
      archivedAt:
        input.archived === undefined
          ? undefined
          : input.archived
            ? (before.archivedAt ?? new Date().toISOString())
            : null,
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new UserFacingError("CONFLICT", NAME_TAKEN);
    throw error;
  }
  return getList(organizationId, input.id);
}

async function deleteList(organizationId: string, id: string) {
  if (!(await ListRepository.remove(organizationId, id))) notFound(id);
  return { id };
}

/**
 * Writes the list's stages as given. A stage left out is removed, refused
 * while anyone is at it (say where they should go first).
 */
async function setStages(
  organizationId: string,
  input: SetListStagesInput,
): Promise<ListSummary> {
  await requireList(organizationId, input.listId);
  const existing = await ListRepository.stagesOf(organizationId, [
    input.listId,
  ]);
  const existingIds = new Set(existing.map((stage) => stage.id));
  for (const stage of input.stages) {
    if (stage.id && !existingIds.has(stage.id)) {
      throw new AppError(
        "NOT_FOUND",
        `This list has no stage with id ${stage.id}.`,
      );
    }
  }
  const names = input.stages.map((stage) => stage.name.toLowerCase());
  if (new Set(names).size < names.length) {
    throw new UserFacingError(
      "VALIDATION_ERROR",
      "Two stages can't share a name.",
    );
  }
  const kept = new Set(
    input.stages.flatMap((stage) => (stage.id ? [stage.id] : [])),
  );
  const removed = existing.filter((stage) => !kept.has(stage.id));
  const occupied = new Map(
    (
      await ListRepository.entriesAtStages(
        organizationId,
        removed.map((stage) => stage.id),
      )
    ).map((row) => [row.stageId, row.count]),
  );
  const blocking = removed.find((stage) => (occupied.get(stage.id) ?? 0) > 0);
  if (blocking) {
    const count = occupied.get(blocking.id) ?? 0;
    throw new UserFacingError(
      "CONFLICT",
      `${count} ${count === 1 ? "is" : "are"} at ${blocking.name}: move ${count === 1 ? "it" : "them"} to another stage before removing it.`,
    );
  }
  await ListRepository.writeStages(
    organizationId,
    input.listId,
    input.stages.map((stage) => ({
      id: stage.id ?? crypto.randomUUID(),
      name: stage.name,
      kind: stage.kind,
      existing: Boolean(stage.id),
    })),
    removed.map((stage) => stage.id),
  );
  return getList(organizationId, input.listId);
}

/** A live list's row and stages; an archived one takes no changes. */
async function requireLiveList(organizationId: string, id: string) {
  const row = await requireList(organizationId, id);
  if (row.archivedAt) {
    throw new UserFacingError(
      "CONFLICT",
      `${row.name} is archived. Restore it first.`,
    );
  }
  const stages = await ListRepository.stagesOf(organizationId, [id]);
  return { row, stages };
}

/**
 * The stage an add puts records at: the one named (it must be the list's),
 * none for null, and the list's first stage when left out.
 */
function startingStage(stages: StageRow[], stageId: string | null | undefined) {
  if (stageId === undefined) return stages[0]?.id ?? null;
  if (stageId === null) return null;
  if (!stages.some((stage) => stage.id === stageId)) {
    throw new AppError(
      "NOT_FOUND",
      `This list has no stage with id ${stageId}.`,
    );
  }
  return stageId;
}

type AddResult = { added: number; alreadyIn: number; notFound: number };

async function addRecords(
  organizationId: string,
  userId: string | null,
  list: { row: ListRow; stages: StageRow[] },
  recordIds: string[],
  stageId: string | null | undefined,
): Promise<AddResult> {
  const stage = startingStage(list.stages, stageId);
  const unique = [...new Set(recordIds)];
  const live = await ListEntryRepository.liveRecordIds(
    organizationId,
    list.row.entity,
    unique,
  );
  const existing = await ListEntryRepository.entriesFor(
    organizationId,
    list.row.id,
    list.row.entity,
    live,
  );
  const missing = live.filter((id) => !existing.has(id));
  await ListEntryRepository.insert(organizationId, list.row, missing, {
    stageId: stage,
    addedById: userId,
  });
  return {
    added: missing.length,
    alreadyIn: live.length - missing.length,
    notFound: unique.length - live.length,
  };
}

/** Puts the contacts or companies `ids` in the list. */
async function addToList(
  organizationId: string,
  userId: string | null,
  input: AddToListInput,
): Promise<AddResult> {
  const list = await requireLiveList(organizationId, input.listId);
  return addRecords(organizationId, userId, list, input.ids, input.stageId);
}

/**
 * Puts everyone the contacts or companies list's filters match in the list
 * (the list's entity says which), up to LIST_MATCHING_MAX.
 */
async function addMatchingToList(
  organizationId: string,
  userId: string | null,
  input: AddMatchingToListInput,
): Promise<AddResult & { matched: number }> {
  const list = await requireLiveList(organizationId, input.listId);
  const ids = await matchingIds(organizationId, list.row.entity, input.filters);
  const result = await addRecords(
    organizationId,
    userId,
    list,
    ids,
    input.stageId,
  );
  return { ...result, matched: ids.length };
}

async function removeFromList(
  organizationId: string,
  input: RemoveFromListInput,
) {
  const row = await requireList(organizationId, input.listId);
  const removed = await ListEntryRepository.remove(
    organizationId,
    row.id,
    row.entity,
    input.ids,
  );
  return { removed, notInList: new Set(input.ids).size - removed };
}

type StageResult = {
  moved: number;
  /** Already at that stage. */
  unchanged: number;
  /** Not in the list (add them first). */
  notInList: number;
};

/**
 * Moves the list's `ids` to a stage (or none), each move a line on their
 * timeline with the note given, if any.
 */
async function setStage(
  organizationId: string,
  userId: string | null,
  input: SetListStageInput,
): Promise<StageResult> {
  const { row, stages } = await requireLiveList(organizationId, input.listId);
  const to =
    input.stageId === null ? null : startingStage(stages, input.stageId);
  const nameOf = (stageId: string | null) =>
    stages.find((stage) => stage.id === stageId)?.name ?? null;
  const unique = [...new Set(input.ids)];
  const entries = await ListEntryRepository.entriesFor(
    organizationId,
    row.id,
    row.entity,
    unique,
  );
  const result: StageResult = { moved: 0, unchanged: 0, notInList: 0 };
  for (const recordId of unique) {
    const entry = entries.get(recordId);
    if (!entry) {
      result.notInList += 1;
      continue;
    }
    if (entry.stageId === to) {
      result.unchanged += 1;
      continue;
    }
    const moved = await ListEntryRepository.moveStage(organizationId, {
      entryId: entry.id,
      entity: row.entity,
      recordId,
      from: entry.stageId,
      to,
      meta: {
        list: row.name,
        listId: row.id,
        from: nameOf(entry.stageId),
        to: nameOf(to),
      },
      note: input.note || null,
      movedById: userId,
    });
    if (moved) result.moved += 1;
    else result.unchanged += 1;
  }
  return result;
}

export const ListService = {
  listLists,
  getList,
  createList,
  updateList,
  deleteList,
  setStages,
  addToList,
  addMatchingToList,
  removeFromList,
  setStage,
  listEntries,
  membershipsOf,
  recordLists,
};
