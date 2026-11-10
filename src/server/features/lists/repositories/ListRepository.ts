import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  company,
  contact,
  listEntry,
  listStage,
  recordList,
} from "@/db/schema";
import { dueCondition } from "@/server/features/lists/repositories/listConditions";
import type { ListEntity, StageKind } from "@/shared/crm-enums";

// Lists and their stages. Every list is the whole organization's; its
// entries (who is in it, at which stage) are ListEntryRepository's.

export type ListRow = typeof recordList.$inferSelect;
export type StageRow = typeof listStage.$inferSelect;

type ListPatch = Partial<
  Pick<
    ListRow,
    "name" | "color" | "description" | "followUpDays" | "archivedAt"
  >
>;

function inOrganization(organizationId: string, id: string) {
  return and(
    eq(recordList.organizationId, organizationId),
    eq(recordList.id, id),
  );
}

/** The stages of `listIds`, in order. */
async function stagesOf(organizationId: string, listIds: string[]) {
  if (listIds.length === 0) return [];
  return db
    .select()
    .from(listStage)
    .where(
      and(
        eq(listStage.organizationId, organizationId),
        inArray(listStage.listId, listIds),
      ),
    )
    .orderBy(asc(listStage.listId), asc(listStage.position));
}

/** The organization's lists, live ones only unless asked, by name. */
async function list(organizationId: string, includeArchived: boolean) {
  return db
    .select()
    .from(recordList)
    .where(
      and(
        eq(recordList.organizationId, organizationId),
        includeArchived ? undefined : isNull(recordList.archivedAt),
      ),
    )
    .orderBy(asc(sql`lower(${recordList.name})`));
}

async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(recordList)
    .where(inOrganization(organizationId, id))
    .limit(1);
  return row ?? null;
}

/**
 * How many live records each of the organization's lists holds, by stage
 * (null for none), and how many of them are Due.
 */
async function entryCounts(organizationId: string) {
  const counted = (entity: ListEntity) => {
    const table = entity === "CONTACT" ? contact : company;
    const key =
      entity === "CONTACT" ? listEntry.contactId : listEntry.companyId;
    return db
      .select({
        listId: listEntry.listId,
        stageId: listEntry.stageId,
        count: count(),
        due: sql<number>`sum(case when ${dueCondition(table.lastActivityAt)} then 1 else 0 end)`.mapWith(
          Number,
        ),
      })
      .from(listEntry)
      .innerJoin(recordList, eq(recordList.id, listEntry.listId))
      .innerJoin(
        table,
        and(
          eq(table.id, key),
          eq(table.organizationId, listEntry.organizationId),
        ),
      )
      .leftJoin(listStage, eq(listStage.id, listEntry.stageId))
      .where(
        and(
          eq(listEntry.organizationId, organizationId),
          eq(recordList.entity, entity),
          isNull(table.archivedAt),
        ),
      )
      .groupBy(listEntry.listId, listEntry.stageId);
  };
  const [contacts, companies] = await Promise.all([
    counted("CONTACT"),
    counted("COMPANY"),
  ]);
  return [...contacts, ...companies];
}

type NewStage = { name: string; kind: StageKind };

/** Makes the list and its stages in one batch. */
async function insert(
  row: Omit<typeof recordList.$inferInsert, "createdAt" | "updatedAt">,
  stages: NewStage[],
) {
  await runBatch((tx) => [
    tx.insert(recordList).values(row),
    ...stages.map((stage, position) =>
      tx.insert(listStage).values({
        id: crypto.randomUUID(),
        organizationId: row.organizationId,
        listId: row.id,
        name: stage.name,
        kind: stage.kind,
        position,
      }),
    ),
  ]);
}

async function update(organizationId: string, id: string, patch: ListPatch) {
  const [row] = await db
    .update(recordList)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(inOrganization(organizationId, id))
    .returning();
  return row ?? null;
}

/** Deletes the list, its stages and entries; never the records. */
async function remove(organizationId: string, id: string) {
  const rows = await db
    .delete(recordList)
    .where(inOrganization(organizationId, id))
    .returning({ id: recordList.id });
  return rows.length > 0;
}

/** The entry's record is live: an archived one holds no stage open. */
function ofLiveRecord() {
  return or(
    exists(
      db
        .select({ id: contact.id })
        .from(contact)
        .where(
          and(eq(contact.id, listEntry.contactId), isNull(contact.archivedAt)),
        ),
    ),
    exists(
      db
        .select({ id: company.id })
        .from(company)
        .where(
          and(eq(company.id, listEntry.companyId), isNull(company.archivedAt)),
        ),
    ),
  );
}

/** How many live records are at each of `stageIds`. */
async function liveAtStages(organizationId: string, stageIds: string[]) {
  if (stageIds.length === 0) return [];
  return db
    .select({ stageId: listEntry.stageId, count: count() })
    .from(listEntry)
    .where(
      and(
        eq(listEntry.organizationId, organizationId),
        inArray(listEntry.stageId, stageIds),
        ofLiveRecord(),
      ),
    )
    .groupBy(listEntry.stageId);
}

type StageWrite = {
  id: string;
  name: string;
  kind: StageKind;
  existing: boolean;
};

/**
 * Writes the list's stages as given, in order, and deletes `removed` (each
 * only while nobody live is at it: one someone moved into meanwhile stays).
 * An archived record's entry at a deleted stage is left at none.
 */
async function writeStages(
  organizationId: string,
  listId: string,
  stages: StageWrite[],
  removed: string[],
) {
  await runBatch((tx) => [
    ...removed.map((stageId) =>
      tx.delete(listStage).where(
        and(
          eq(listStage.organizationId, organizationId),
          eq(listStage.listId, listId),
          eq(listStage.id, stageId),
          notExists(
            tx
              .select({ id: listEntry.id })
              .from(listEntry)
              .where(and(eq(listEntry.stageId, stageId), ofLiveRecord())),
          ),
        ),
      ),
    ),
    ...stages.map((stage, position) =>
      stage.existing
        ? tx
            .update(listStage)
            .set({ name: stage.name, kind: stage.kind, position })
            .where(
              and(
                eq(listStage.organizationId, organizationId),
                eq(listStage.listId, listId),
                eq(listStage.id, stage.id),
              ),
            )
        : tx.insert(listStage).values({
            id: stage.id,
            organizationId,
            listId,
            name: stage.name,
            kind: stage.kind,
            position,
          }),
    ),
    tx
      .update(recordList)
      .set({ updatedAt: new Date().toISOString() })
      .where(inOrganization(organizationId, listId)),
  ]);
}

export const ListRepository = {
  list,
  findById,
  stagesOf,
  entryCounts,
  insert,
  update,
  remove,
  liveAtStages,
  writeStages,
};
