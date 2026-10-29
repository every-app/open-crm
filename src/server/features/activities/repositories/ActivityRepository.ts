import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { activity, company, contact, deal } from "@/db/schema";
import {
  selectEntries,
  timelineAt,
  toEntry,
} from "@/server/features/activities/repositories/activityEntries";
import type { ActivityType } from "@/shared/crm-enums";
import type { RecordRef } from "@/shared/records";
import type {
  TaskWindow,
  TimelineFilter,
  TaskDue,
} from "@/types/schemas/activities";

// Activities: everything on a record's timeline. Writing one moves its
// records' last activity up to it in the same batch, as the CRM's activity
// stamp does: a record's `last_activity_at` is the creation time of its
// newest activity, whatever its type, and never moves back when an older one
// is written. A purge recomputes it the same way from what is left
// (ArchiveRepository's restamp).

function openTask(): SQL {
  return sql`(${activity.type} = 'TASK' and ${activity.completedAt} is null)`;
}

/** The activities a timeline view shows. */
function filterCondition(filter: Exclude<TimelineFilter, "all">): SQL {
  switch (filter) {
    case "notes":
      return eq(activity.type, "NOTE");
    case "calls":
      return eq(activity.type, "CALL");
    case "open-tasks":
      return openTask();
    case "completed-tasks":
      return sql`(${activity.type} = 'TASK' and ${activity.completedAt} is not null)`;
    case "history":
      return sql`not ${openTask()}`;
    case "email":
      return eq(activity.type, "EMAIL");
    case "meetings":
      return eq(activity.type, "MEETING");
  }
}

function about(organizationId: string, record: RecordRef) {
  const anchor = {
    company: activity.companyId,
    contact: activity.contactId,
    deal: activity.dealId,
  }[record.kind];
  return and(
    eq(activity.organizationId, organizationId),
    eq(anchor, record.id),
  );
}

/** After `cursor` ("<timeline time>|<id>", the last entry of a page). */
function afterCursor(cursor: string): SQL {
  const split = cursor.indexOf("|");
  const at = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  const when = timelineAt();
  return or(lt(when, at), and(eq(when, at), lt(activity.id, id))) ?? sql`false`;
}

/** A page of a record's timeline, newest first, the id breaking ties. */
async function timeline(
  organizationId: string,
  input: {
    record: RecordRef;
    filter: TimelineFilter;
    due?: TaskDue;
    cursor?: string;
    limit: number;
  },
) {
  const rows = await selectEntries(
    and(
      about(organizationId, input.record),
      input.filter === "all" ? undefined : filterCondition(input.filter),
      input.due ? eq(activity.type, "TASK") : undefined,
      input.due
        ? {
            overdue: lt(activity.dueAt, new Date().toISOString()),
            upcoming: gte(activity.dueAt, new Date().toISOString()),
            undated: isNull(activity.dueAt),
          }[input.due]
        : undefined,
      input.cursor ? afterCursor(input.cursor) : undefined,
    ),
  )
    .orderBy(desc(timelineAt()), desc(activity.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    entries: page.map(toEntry),
    nextCursor:
      rows.length > input.limit && last ? `${last.at}|${last.id}` : null,
  };
}

/** How many activities each view of a record's timeline shows. */
async function counts(organizationId: string, record: RecordRef) {
  const tally = (filter: Exclude<TimelineFilter, "all">) =>
    sql<number>`count(case when ${filterCondition(filter)} then 1 end)`.mapWith(
      Number,
    );
  const [row] = await db
    .select({
      all: count(),
      notes: tally("notes"),
      calls: tally("calls"),
      "open-tasks": tally("open-tasks"),
      "completed-tasks": tally("completed-tasks"),
      email: tally("email"),
      meetings: tally("meetings"),
    })
    .from(activity)
    .where(about(organizationId, record));
  return (
    row ?? {
      all: 0,
      notes: 0,
      calls: 0,
      "open-tasks": 0,
      "completed-tasks": 0,
      email: 0,
      meetings: 0,
    }
  );
}

/** One of the organization's activities, or null. */
async function findById(organizationId: string, id: string) {
  const [row] = await selectEntries(
    and(eq(activity.organizationId, organizationId), eq(activity.id, id)),
  ).limit(1);
  return row ? toEntry(row) : null;
}

/**
 * The open tasks `userId` set themselves, soonest due first and undated
 * ones last. `now` splits the overdue from the upcoming.
 */
async function openTasks(
  organizationId: string,
  input: { userId: string; window: TaskWindow; limit: number; now: string },
) {
  const due = {
    all: undefined,
    overdue: lt(activity.dueAt, input.now),
    upcoming: gte(activity.dueAt, input.now),
  }[input.window];
  const rows = await selectEntries(
    and(
      eq(activity.organizationId, organizationId),
      eq(activity.createdById, input.userId),
      openTask(),
      due,
    ),
  )
    .orderBy(
      sql`(${activity.dueAt} is null)`,
      asc(activity.dueAt),
      desc(activity.createdAt),
      asc(activity.id),
    )
    .limit(input.limit);
  return rows.map(toEntry);
}

/** The newest activities written, only `createdById`'s when given. */
async function recent(
  organizationId: string,
  input: { createdById: string | null; limit: number },
) {
  const rows = await selectEntries(
    and(
      eq(activity.organizationId, organizationId),
      input.createdById
        ? eq(activity.createdById, input.createdById)
        : undefined,
    ),
  )
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(input.limit);
  return rows.map(toEntry);
}

type NewActivity = {
  organizationId: string;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  occurredAt: string | null;
  dueAt: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  /** Null for an automated entry (mail capture, a website form). */
  createdById: string | null;
  meta?: Record<string, unknown> | null;
};

type StampedTable = typeof company | typeof contact | typeof deal;

/** Moves a record's last activity up to `at`, never back. */
function touch(
  tx: typeof db,
  table: StampedTable,
  organizationId: string,
  id: string,
  at: string,
) {
  return tx
    .update(table)
    .set({ lastActivityAt: at })
    .where(
      and(
        eq(table.organizationId, organizationId),
        eq(table.id, id),
        or(isNull(table.lastActivityAt), lt(table.lastActivityAt, at)),
      ),
    );
}

/**
 * Writes an activity and, in the same batch, moves the last activity of the
 * company, contact and deal it is filed on up to its creation time. Every
 * activity should be written here (stage changes and automated entries
 * included), so lists sorted by last activity stay true. The new id.
 */
async function insert(values: NewActivity): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const targets: [StampedTable, string | null][] = [
    [company, values.companyId],
    [contact, values.contactId],
    [deal, values.dealId],
  ];
  await runBatch((tx) => [
    tx.insert(activity).values({
      ...values,
      meta: values.meta ?? null,
      id,
      createdAt: now,
      updatedAt: now,
    }),
    ...targets.flatMap(([table, recordId]) =>
      recordId ? [touch(tx, table, values.organizationId, recordId, now)] : [],
    ),
  ]);
  return id;
}

/**
 * Ticks a task off, or opens it again (`completedAt` null). False when the
 * organization has no task with that id.
 */
async function setCompleted(
  organizationId: string,
  id: string,
  completedAt: string | null,
): Promise<boolean> {
  const rows = await db
    .update(activity)
    .set({ completedAt, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(activity.organizationId, organizationId),
        eq(activity.id, id),
        eq(activity.type, "TASK"),
      ),
    )
    .returning({ id: activity.id });
  return rows.length > 0;
}

type ActivityPatch = Partial<
  Pick<
    typeof activity.$inferInsert,
    "subject" | "body" | "occurredAt" | "dueAt"
  >
>;

/**
 * Changes an activity's text or times; false when the organization has no
 * such activity.
 */
async function update(
  organizationId: string,
  id: string,
  patch: ActivityPatch,
): Promise<boolean> {
  const rows = await db
    .update(activity)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(
      and(eq(activity.organizationId, organizationId), eq(activity.id, id)),
    )
    .returning({ id: activity.id });
  return rows.length > 0;
}

/** Deletes an activity; false when the organization has no such activity. */
async function remove(organizationId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(activity)
    .where(
      and(eq(activity.organizationId, organizationId), eq(activity.id, id)),
    )
    .returning({ id: activity.id });
  return rows.length > 0;
}

/**
 * The company a record of the organization is filed under (the company
 * itself, for one), or null when the organization has no such record.
 */
async function recordCompany(
  organizationId: string,
  record: RecordRef,
): Promise<{ companyId: string | null } | null> {
  if (record.kind === "company") {
    const [row] = await db
      .select({ companyId: company.id })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          eq(company.id, record.id),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const table = record.kind === "contact" ? contact : deal;
  const [row] = await db
    .select({ companyId: table.companyId })
    .from(table)
    .where(
      and(eq(table.organizationId, organizationId), eq(table.id, record.id)),
    )
    .limit(1);
  return row ?? null;
}

export const ActivityRepository = {
  timeline,
  counts,
  findById,
  openTasks,
  recent,
  insert,
  setCompleted,
  update,
  remove,
  recordCompany,
};
