import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  company,
  contact,
  listEntry,
  listStage,
  recordList,
} from "@/db/schema";
import {
  dueCondition,
  stageCondition,
} from "@/server/features/lists/repositories/listConditions";
import { idChunks } from "@/server/features/records/recordRules";
import type { ListEntity } from "@/shared/crm-enums";

// A list's board: its entries with what each card shows.

const recordTable = (entity: ListEntity) =>
  entity === "CONTACT" ? contact : company;
const entryKey = (entity: ListEntity) =>
  entity === "CONTACT" ? listEntry.contactId : listEntry.companyId;

type BoardFilter = { stage: string[]; due: boolean; limit: number };

/**
 * The list's entries for its board: each live record with what its card
 * shows, its stage, its last activity and whether it is Due, the most
 * recently moved first.
 */
async function board(
  organizationId: string,
  list: { id: string; entity: ListEntity },
  filter: BoardFilter,
) {
  const table = recordTable(list.entity);
  const key = entryKey(list.entity);
  const due = dueCondition(table.lastActivityAt);
  const where = and(
    eq(listEntry.organizationId, organizationId),
    eq(listEntry.listId, list.id),
    isNull(table.archivedAt),
    stageCondition(filter.stage),
    filter.due ? due : undefined,
  );
  const base = () =>
    db
      .select({
        entryId: listEntry.id,
        recordId: table.id,
        stageId: listEntry.stageId,
        stageChangedAt: listEntry.stageChangedAt,
        addedAt: listEntry.addedAt,
        lastActivityAt: table.lastActivityAt,
        due: sql<number>`${due}`.mapWith(Boolean),
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
      .where(where)
      .orderBy(desc(listEntry.stageChangedAt), asc(listEntry.id))
      .limit(filter.limit);
  const [rows, [total]] = await Promise.all([
    base(),
    db
      .select({ value: count() })
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
      .where(where),
  ]);
  return { rows, total: total?.value ?? 0 };
}

/** What a board card or chip names: a contact's name and title, a company's name and domain. */
async function cardsFor(
  entity: ListEntity,
  organizationId: string,
  ids: string[],
) {
  const cards = new Map<
    string,
    { name: string; detail: string | null; imageUrl: string | null }
  >();
  for (const part of idChunks(ids)) {
    if (entity === "CONTACT") {
      const rows = await db
        .select({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          companyName: company.name,
          imageUrl: contact.imageUrl,
        })
        .from(contact)
        .leftJoin(
          company,
          and(
            eq(company.id, contact.companyId),
            eq(company.organizationId, contact.organizationId),
          ),
        )
        .where(
          and(
            eq(contact.organizationId, organizationId),
            inArray(contact.id, part),
          ),
        );
      for (const row of rows)
        cards.set(row.id, {
          name: [row.firstName, row.lastName].filter(Boolean).join(" "),
          detail:
            [row.title, row.companyName].filter(Boolean).join(" · ") || null,
          imageUrl: row.imageUrl,
        });
    } else {
      const rows = await db
        .select({
          id: company.id,
          name: company.name,
          domain: company.domain,
          iconUrl: company.iconUrl,
        })
        .from(company)
        .where(
          and(
            eq(company.organizationId, organizationId),
            inArray(company.id, part),
          ),
        );
      for (const row of rows)
        cards.set(row.id, {
          name: row.name,
          detail: row.domain,
          imageUrl: row.iconUrl,
        });
    }
  }
  return cards;
}

export const ListBoardRepository = { board, cardsFor };
