import { ListBoardRepository } from "@/server/features/lists/repositories/ListBoardRepository";
import { ListRepository } from "@/server/features/lists/repositories/ListRepository";
import { AppError } from "@/server/lib/errors";
import type { ListEntriesInput } from "@/types/schemas/lists";

/** The list's board: its entries with their cards, stage and Due. */
export async function listEntries(
  organizationId: string,
  input: ListEntriesInput,
) {
  const row = await ListRepository.findById(organizationId, input.listId);
  if (!row) throw new AppError("NOT_FOUND", `No list with id ${input.listId}.`);
  const { rows, total } = await ListBoardRepository.board(
    organizationId,
    { id: row.id, entity: row.entity },
    { stage: input.stage, due: input.due, limit: input.limit },
  );
  const cards = await ListBoardRepository.cardsFor(
    row.entity,
    organizationId,
    rows.map((entry) => entry.recordId),
  );
  return {
    entries: rows.map((entry) => ({
      ...entry,
      name: cards.get(entry.recordId)?.name ?? "",
      detail: cards.get(entry.recordId)?.detail ?? null,
      imageUrl: cards.get(entry.recordId)?.imageUrl ?? null,
    })),
    total,
  };
}
