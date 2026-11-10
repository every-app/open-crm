import { ListRepository } from "@/server/features/lists/repositories/ListRepository";
import { AppError, UserFacingError } from "@/server/lib/errors";
import type { SetListStagesInput } from "@/types/schemas/lists";

/**
 * What writing the list's stages as given takes. A stage left out is
 * removed, refused while anyone live is at it (say where they should go
 * first); an archived record at it is left at no stage.
 */
export async function stageWrites(
  organizationId: string,
  listId: string,
  stages: SetListStagesInput["stages"],
) {
  const existing = await ListRepository.stagesOf(organizationId, [listId]);
  const existingIds = new Set(existing.map((stage) => stage.id));
  for (const stage of stages) {
    if (stage.id && !existingIds.has(stage.id)) {
      throw new AppError(
        "NOT_FOUND",
        `This list has no stage with id ${stage.id}.`,
      );
    }
  }
  const names = stages.map((stage) => stage.name.toLowerCase());
  if (new Set(names).size < names.length) {
    throw new UserFacingError(
      "VALIDATION_ERROR",
      "Two stages can't share a name.",
    );
  }
  const kept = new Set(stages.flatMap((stage) => (stage.id ? [stage.id] : [])));
  const removed = existing.filter((stage) => !kept.has(stage.id));
  const occupied = new Map(
    (
      await ListRepository.liveAtStages(
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
  return {
    written: stages.map((stage) => ({
      id: stage.id ?? crypto.randomUUID(),
      name: stage.name,
      kind: stage.kind,
      existing: Boolean(stage.id),
    })),
    removed: removed.map((stage) => stage.id),
  };
}
