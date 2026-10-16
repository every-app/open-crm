import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { savedView } from "@/db/schema";
import type { FieldEntity } from "@/shared/crm-enums";

export type SavedViewRow = typeof savedView.$inferSelect;

type SavedViewPatch = Partial<
  Pick<SavedViewRow, "name" | "shared" | "filters">
>;

/** The entity's views `userId` can see: their own and the shared ones. */
async function listVisible(
  organizationId: string,
  entity: FieldEntity,
  userId: string,
): Promise<SavedViewRow[]> {
  return db
    .select()
    .from(savedView)
    .where(
      and(
        eq(savedView.organizationId, organizationId),
        eq(savedView.entity, entity),
        or(eq(savedView.shared, true), eq(savedView.ownerId, userId)),
      ),
    )
    .orderBy(asc(savedView.name), asc(savedView.createdAt));
}

async function insert(
  row: Omit<typeof savedView.$inferInsert, "createdAt" | "updatedAt">,
): Promise<SavedViewRow> {
  const [created] = await db.insert(savedView).values(row).returning();
  if (!created) throw new Error("Saved view missing after insert");
  return created;
}

/** Changes one of `ownerId`'s views. Null when they have no view `id`. */
async function updateOwned(
  organizationId: string,
  ownerId: string,
  id: string,
  patch: SavedViewPatch,
): Promise<SavedViewRow | null> {
  const [updated] = await db
    .update(savedView)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(savedView.organizationId, organizationId),
        eq(savedView.ownerId, ownerId),
        eq(savedView.id, id),
      ),
    )
    .returning();
  return updated ?? null;
}

/** Deletes one of `ownerId`'s views. False when they have no view `id`. */
async function removeOwned(
  organizationId: string,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(savedView)
    .where(
      and(
        eq(savedView.organizationId, organizationId),
        eq(savedView.ownerId, ownerId),
        eq(savedView.id, id),
      ),
    )
    .returning({ id: savedView.id });
  return deleted.length > 0;
}

export const SavedViewRepository = {
  listVisible,
  insert,
  updateOwned,
  removeOwned,
};
