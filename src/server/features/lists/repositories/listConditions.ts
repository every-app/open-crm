import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { listEntry, listStage, recordList } from "@/db/schema";
import type { ListEntity } from "@/shared/crm-enums";
import { NO_STAGE } from "@/types/schemas/records";

// The SQL lists are read through: whether an entry is Due, and the contacts
// and companies lists' "in this list, at these stages" filter.

/**
 * An entry is Due when its list follows up, it is at an open stage (or at
 * none), and its record has been quiet, since it was added at least, for
 * the list's days. Needs `record_list`, `list_stage` (left) and
 * `list_entry` in the query, and the record's last activity.
 */
export function dueCondition(lastActivityAt: AnyColumn): SQL {
  return sql`(${recordList.followUpDays} is not null and coalesce(${listStage.kind}, 'OPEN') = 'OPEN' and max(coalesce(${lastActivityAt}, ${listEntry.addedAt}), ${listEntry.addedAt}) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ${recordList.followUpDays} || ' days'))`;
}

/** The entry's stage filter: the chosen stage ids, and NO_STAGE for none. */
export function stageCondition(values: string[]): SQL | undefined {
  if (values.length === 0) return undefined;
  const ids = values.filter((value) => value !== NO_STAGE);
  return or(
    ids.length > 0 ? inArray(listEntry.stageId, ids) : undefined,
    ids.length < values.length ? isNull(listEntry.stageId) : undefined,
  );
}

type MembershipFilter = { list?: string; listStage: string[]; due: boolean };

/**
 * The contacts or companies list narrowed to one list: records with an
 * entry in it, at the chosen stages, Due only when asked. None when no list
 * is chosen.
 */
export function membershipCondition(
  organizationId: string,
  entity: ListEntity,
  filter: MembershipFilter,
  record: { id: AnyColumn; lastActivityAt: AnyColumn },
): SQL | undefined {
  if (!filter.list) return undefined;
  const key = entity === "CONTACT" ? listEntry.contactId : listEntry.companyId;
  return exists(
    db
      .select({ id: listEntry.id })
      .from(listEntry)
      .innerJoin(recordList, eq(recordList.id, listEntry.listId))
      .leftJoin(listStage, eq(listStage.id, listEntry.stageId))
      .where(
        and(
          eq(listEntry.organizationId, organizationId),
          eq(listEntry.listId, filter.list),
          eq(key, record.id),
          stageCondition(filter.listStage),
          filter.due ? dueCondition(record.lastActivityAt) : undefined,
        ),
      ),
  );
}
