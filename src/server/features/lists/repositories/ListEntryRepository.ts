import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches, runBatch } from "@/db/runBatch";
import {
  activity,
  company,
  contact,
  listEntry,
  listStage,
  recordList,
} from "@/db/schema";
import { dueCondition } from "@/server/features/lists/repositories/listConditions";
import { idChunks } from "@/server/features/records/recordRules";
import type { ListEntity } from "@/shared/crm-enums";
import { NO_STAGE } from "@/types/schemas/records";

// Who is in a list, at which stage. An entry names a contact or a company,
// as its list holds; a record is in a list at most once (the partial unique
// indexes list_entry_list_contact_uidx and _company_uidx).

const recordTable = (entity: ListEntity) =>
  entity === "CONTACT" ? contact : company;
const entryKey = (entity: ListEntity) =>
  entity === "CONTACT" ? listEntry.contactId : listEntry.companyId;

/** The live records of `entity` among `ids` that are the organization's. */
async function liveRecordIds(
  organizationId: string,
  entity: ListEntity,
  ids: string[],
) {
  const table = recordTable(entity);
  const found: string[] = [];
  for (const part of idChunks(ids)) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.organizationId, organizationId),
          inArray(table.id, part),
          isNull(table.archivedAt),
        ),
      );
    found.push(...rows.map((row) => row.id));
  }
  return found;
}

/** The list's entries for `recordIds`, by record id. */
async function entriesFor(
  organizationId: string,
  listId: string,
  entity: ListEntity,
  recordIds: string[],
) {
  const key = entryKey(entity);
  const entries = new Map<string, { id: string; stageId: string | null }>();
  for (const part of idChunks(recordIds)) {
    const rows = await db
      .select({ id: listEntry.id, recordId: key, stageId: listEntry.stageId })
      .from(listEntry)
      .where(
        and(
          eq(listEntry.organizationId, organizationId),
          eq(listEntry.listId, listId),
          inArray(key, part),
        ),
      );
    for (const row of rows)
      if (row.recordId)
        entries.set(row.recordId, { id: row.id, stageId: row.stageId });
  }
  return entries;
}

/**
 * Puts `recordIds` in the list at `stageId`. A record already in it stays
 * as it is (its stage kept): the unique index decides, so two adds at once
 * make one entry.
 */
async function insert(
  organizationId: string,
  list: { id: string; entity: ListEntity },
  recordIds: string[],
  entry: { stageId: string | null; addedById: string | null },
) {
  const { id: listId, entity } = list;
  const { stageId, addedById } = entry;
  const key = entryKey(entity);
  await executeInBatches(recordIds, (tx, recordId) =>
    tx
      .insert(listEntry)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        listId,
        contactId: entity === "CONTACT" ? recordId : null,
        companyId: entity === "COMPANY" ? recordId : null,
        stageId,
        addedById,
      })
      .onConflictDoUpdate({
        target: [listEntry.listId, key],
        targetWhere: sql`${key} is not null`,
        set: { listId: sql`${listEntry.listId}` },
      }),
  );
}

/** Takes `recordIds` out of the list; how many were in it. */
async function remove(
  organizationId: string,
  listId: string,
  entity: ListEntity,
  recordIds: string[],
) {
  const key = entryKey(entity);
  let removed = 0;
  for (const part of idChunks(recordIds)) {
    const rows = await db
      .delete(listEntry)
      .where(
        and(
          eq(listEntry.organizationId, organizationId),
          eq(listEntry.listId, listId),
          inArray(key, part),
        ),
      )
      .returning({ id: listEntry.id });
    removed += rows.length;
  }
  return removed;
}

type StageMove = {
  entryId: string;
  entity: ListEntity;
  recordId: string;
  from: string | null;
  to: string | null;
  /** The list and stage names, kept on the timeline line as they were. */
  meta: {
    list: string;
    listId: string;
    from: string | null;
    to: string | null;
  };
  note: string | null;
  movedById: string | null;
};

/**
 * Moves the entry from `from` to `to` and files the move on its record's
 * timeline (a STAGE_CHANGE activity), in one batch. The move lands only
 * while the entry is still at `from`, so of two people moving it at once
 * one wins, and the loser's activity is taken back out in the same batch.
 * The record's last activity moves up to the move. True when this call
 * moved it.
 */
async function moveStage(organizationId: string, move: StageMove) {
  const at = new Date().toISOString();
  const activityId = crypto.randomUUID();
  const table = recordTable(move.entity);
  const stageIs = (stageId: string | null) =>
    stageId === null
      ? isNull(listEntry.stageId)
      : eq(listEntry.stageId, stageId);
  const entry = and(
    eq(listEntry.organizationId, organizationId),
    eq(listEntry.id, move.entryId),
  );
  await runBatch((tx) => {
    // The entry as this move leaves it, which every later statement needs.
    const moved = tx
      .select({ id: listEntry.id })
      .from(listEntry)
      .where(and(entry, stageIs(move.to), eq(listEntry.stageChangedAt, at)));
    return [
      tx
        .update(listEntry)
        .set({ stageId: move.to, stageChangedAt: at })
        .where(and(entry, stageIs(move.from))),
      tx.insert(activity).values({
        id: activityId,
        organizationId,
        type: "STAGE_CHANGE",
        subject: "Stage changed",
        body: move.note,
        occurredAt: at,
        contactId: move.entity === "CONTACT" ? move.recordId : null,
        companyId: move.entity === "COMPANY" ? move.recordId : null,
        listEntryId: move.entryId,
        createdById: move.movedById,
        meta: move.meta,
        createdAt: at,
        updatedAt: at,
      }),
      tx
        .delete(activity)
        .where(
          and(
            eq(activity.organizationId, organizationId),
            eq(activity.id, activityId),
            notExists(moved),
          ),
        ),
      tx
        .update(table)
        .set({ lastActivityAt: at })
        .where(
          and(
            eq(table.organizationId, organizationId),
            eq(table.id, move.recordId),
            or(isNull(table.lastActivityAt), lt(table.lastActivityAt, at)),
            exists(moved),
          ),
        ),
    ];
  });
  const [filed] = await db
    .select({ id: activity.id })
    .from(activity)
    .where(
      and(
        eq(activity.organizationId, organizationId),
        eq(activity.id, activityId),
      ),
    );
  return Boolean(filed);
}

/**
 * The live lists `recordIds` are in, with each one's stage there, by record
 * id: the chips on the contacts and companies tables, and a sheet's Lists.
 */
async function membershipsOf(
  organizationId: string,
  entity: ListEntity,
  recordIds: string[],
) {
  const key = entryKey(entity);
  const table = recordTable(entity);
  const memberships = new Map<
    string,
    {
      entryId: string;
      listId: string;
      stageId: string | null;
      addedAt: string;
      due: boolean;
    }[]
  >();
  for (const part of idChunks(recordIds)) {
    const rows = await db
      .select({
        recordId: key,
        entryId: listEntry.id,
        listId: listEntry.listId,
        stageId: listEntry.stageId,
        addedAt: listEntry.addedAt,
        due: sql<number>`${dueCondition(table.lastActivityAt)}`.mapWith(
          Boolean,
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
          inArray(key, part),
          isNull(recordList.archivedAt),
        ),
      )
      .orderBy(asc(sql`lower(${recordList.name})`));
    for (const { recordId, ...membership } of rows) {
      if (!recordId) continue;
      memberships.set(recordId, [
        ...(memberships.get(recordId) ?? []),
        membership,
      ]);
    }
  }
  return memberships;
}

/**
 * How many records in a list's scope (`scope`, a subquery of record ids)
 * are at each of the list's stages (NO_STAGE for none): the Stage filter's
 * counts.
 */
async function stageCounts(
  organizationId: string,
  listId: string,
  entity: ListEntity,
  scope: SQLWrapper,
) {
  const key = entryKey(entity);
  const rows = await db
    .select({ stageId: listEntry.stageId, count: count() })
    .from(listEntry)
    .where(
      and(
        eq(listEntry.organizationId, organizationId),
        eq(listEntry.listId, listId),
        inArray(key, scope),
      ),
    )
    .groupBy(listEntry.stageId);
  return Object.fromEntries(
    rows.map((row) => [row.stageId ?? NO_STAGE, row.count]),
  );
}

export const ListEntryRepository = {
  liveRecordIds,
  entriesFor,
  insert,
  remove,
  moveStage,
  membershipsOf,
  stageCounts,
};
