import {
  SavedViewRepository,
  type SavedViewRow,
} from "@/server/features/saved-views/repositories/SavedViewRepository";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { AppError } from "@/server/lib/errors";
import type { FieldEntity } from "@/shared/crm-enums";
import {
  savedViewFiltersSchema,
  type CreateSavedViewInput,
  type SavedViewFilters,
  type UpdateSavedViewInput,
} from "@/types/schemas/saved-views";

/** A named list filter, as the person asking sees it. */
export type SavedView = {
  id: string;
  entity: FieldEntity;
  name: string;
  shared: boolean;
  filters: SavedViewFilters;
  /** Theirs to rename, share and delete. */
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

const NAME_TAKEN = "You already have a view with that name.";

const NO_SUCH_VIEW = "You have no such saved view.";

function serialize(row: SavedViewRow, userId: string): SavedView {
  const filters = savedViewFiltersSchema.safeParse(row.filters);
  return {
    id: row.id,
    entity: row.entity,
    name: row.name,
    shared: row.shared,
    filters: filters.success ? filters.data : {},
    mine: row.ownerId === userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** One of the person's own views. */
async function getOwned(
  organizationId: string,
  userId: string,
  id: string,
): Promise<SavedView> {
  const row = await SavedViewRepository.findOwned(organizationId, userId, id);
  if (!row) throw new AppError("NOT_FOUND", NO_SUCH_VIEW);
  return serialize(row, userId);
}

/** The entity's views the person can apply: their own and the team's shared ones. */
async function list(
  organizationId: string,
  userId: string,
  entity: FieldEntity,
): Promise<SavedView[]> {
  const rows = await SavedViewRepository.listVisible(
    organizationId,
    entity,
    userId,
  );
  return rows.map((row) => serialize(row, userId));
}

async function create(
  organizationId: string,
  userId: string,
  input: CreateSavedViewInput,
): Promise<SavedView> {
  try {
    const row = await SavedViewRepository.insert({
      id: crypto.randomUUID(),
      organizationId,
      ownerId: userId,
      entity: input.entity,
      name: input.name,
      shared: input.shared,
      filters: input.filters,
    });
    return serialize(row, userId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", NAME_TAKEN);
    throw error;
  }
}

/** Renames, shares, unshares or re-filters one of the person's own views. */
async function update(
  organizationId: string,
  userId: string,
  input: UpdateSavedViewInput,
): Promise<SavedView> {
  try {
    const row = await SavedViewRepository.updateOwned(
      organizationId,
      userId,
      input.id,
      { name: input.name, shared: input.shared, filters: input.filters },
    );
    if (!row) throw new AppError("NOT_FOUND", NO_SUCH_VIEW);
    return serialize(row, userId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", NAME_TAKEN);
    throw error;
  }
}

async function remove(
  organizationId: string,
  userId: string,
  id: string,
): Promise<{ id: string }> {
  if (!(await SavedViewRepository.removeOwned(organizationId, userId, id))) {
    throw new AppError("NOT_FOUND", NO_SUCH_VIEW);
  }
  return { id };
}

export const SavedViewService = {
  getOwned,
  list,
  create,
  update,
  remove,
};
