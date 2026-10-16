import {
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { activity, company, deal, user } from "@/db/schema";
import { countedIn } from "@/server/features/currency/repositories/DealConversionRepository";
import {
  archivedCondition,
  ownerCondition,
  pageWindow,
  searchCondition,
  sortOrder,
  type SortSpec,
} from "@/server/features/records/listQuery";
import {
  activityTargets,
  clearAgentRows,
  idChunks,
  recomputeLastActivity,
} from "@/server/features/records/recordRules";
import type { DealStage } from "@/shared/crm-enums";
import { roundMoney } from "@/shared/currency";
import {
  CLOSED_DEAL_STAGES,
  DEAL_STAGE_ORDER,
  OPEN_DEAL_STAGES,
  isClosedStage,
} from "@/shared/deal-stages";
import type {
  ClosingWindow,
  DealListInput,
  DealSort,
} from "@/types/schemas/deals";

// Deals: the pipeline's rows. A deal belongs to one company of its
// organization and is owned by one member. Its stage moves only through
// moveStage, which files each move on the deal's timeline.

const stageRank = sql`case ${deal.stage} ${sql.join(
  DEAL_STAGE_ORDER.map(
    (stage, rank) => sql`when ${stage} then ${sql.raw(String(rank))}`,
  ),
  sql` `,
)} end`;

const SORTS = {
  name: { by: sql`lower(${deal.name})` },
  company: {
    by: sql`lower(${company.name})`,
    ties: [sql`lower(${deal.name})`],
  },
  // Pipeline order, the soonest close first within a stage.
  stage: {
    by: stageRank,
    ties: [
      sql`(${deal.expectedCloseDate} is null)`,
      asc(deal.expectedCloseDate),
    ],
  },
  // The reporting-currency figure: the only one that compares across
  // currencies.
  amount: { by: deal.baseAmount, nullsLast: true },
  owner: { by: sql`lower(${user.name})`, ties: [sql`lower(${deal.name})`] },
  expectedCloseDate: { by: deal.expectedCloseDate, nullsLast: true },
  lastActivity: { by: deal.lastActivityAt, nullsLast: true },
  createdAt: { by: deal.createdAt },
} satisfies Record<DealSort, SortSpec>;

const STATUS_STAGES = {
  all: null,
  open: OPEN_DEAL_STAGES,
  closed: CLOSED_DEAL_STAGES,
};

const companyColumns = {
  id: company.id,
  name: company.name,
  domain: company.domain,
  logoUrl: company.logoUrl,
  iconUrl: company.iconUrl,
  iconDarkUrl: company.iconDarkUrl,
  iconTone: company.iconTone,
};

const ownerColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
};

// The deal's company is always its organization's; the join says so too.
const ofItsCompany = and(
  eq(company.id, deal.companyId),
  eq(company.organizationId, deal.organizationId),
);

function inOrganization(organizationId: string, id: string) {
  return and(eq(deal.organizationId, organizationId), eq(deal.id, id));
}

/** The first instant of the UTC month `offset` months after `now`'s. */
function monthStart(now: Date, offset: number): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
  ).toISOString();
}

/**
 * Deals expected to close in `window`. A close date is a day, stored as its
 * UTC midnight, so an open deal is overdue once its day has passed.
 */
function closingCondition(window: ClosingWindow, now: Date): SQL | undefined {
  const closes = deal.expectedCloseDate;
  switch (window) {
    case "overdue": {
      const today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      ).toISOString();
      return and(lt(closes, today), inArray(deal.stage, OPEN_DEAL_STAGES));
    }
    case "this-month":
      return and(
        gte(closes, monthStart(now, 0)),
        lt(closes, monthStart(now, 1)),
      );
    case "next-month":
      return and(
        gte(closes, monthStart(now, 1)),
        lt(closes, monthStart(now, 2)),
      );
    case "later":
      return gte(closes, monthStart(now, 2));
    case "none":
      return isNull(closes);
  }
}

/** A deal whose name, or whose company's name, contains `q`. */
function searchWhere(organizationId: string, q: string): SQL | undefined {
  const byCompanyName = searchCondition(q, [company.name]);
  if (!byCompanyName) return undefined;
  return or(
    searchCondition(q, [deal.name]),
    inArray(
      deal.companyId,
      db
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.organizationId, organizationId), byCompanyName)),
    ),
  );
}

/**
 * The list's view: everything but its page and order. It names only the
 * deal's own columns, so totals over the view need no join.
 */
function listWhere(organizationId: string, input: DealListInput) {
  const now = new Date();
  const statusStages = STATUS_STAGES[input.status];
  return and(
    eq(deal.organizationId, organizationId),
    archivedCondition(deal.archivedAt, input.archived),
    searchWhere(organizationId, input.q),
    ownerCondition(deal.ownerId, input.owner),
    statusStages ? inArray(deal.stage, statusStages) : undefined,
    input.stage.length > 0 ? inArray(deal.stage, input.stage) : undefined,
    input.closing.length > 0
      ? or(...input.closing.map((window) => closingCondition(window, now)))
      : undefined,
  );
}

/** The open deals in the list's view: what its pipeline total adds up. */
function openInView(organizationId: string, input: DealListInput) {
  return and(
    listWhere(organizationId, input),
    inArray(deal.stage, OPEN_DEAL_STAGES),
  );
}

async function list(organizationId: string, input: DealListInput) {
  const where = listWhere(organizationId, input);
  const { limit, offset } = pageWindow(input);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
        amount: deal.amount,
        currency: deal.currency,
        baseAmount: deal.baseAmount,
        baseCurrency: deal.baseCurrency,
        expectedCloseDate: deal.expectedCloseDate,
        closedAt: deal.closedAt,
        lastActivityAt: deal.lastActivityAt,
        createdAt: deal.createdAt,
        archivedAt: deal.archivedAt,
        company: companyColumns,
        owner: ownerColumns,
      })
      .from(deal)
      .innerJoin(company, ofItsCompany)
      .innerJoin(user, eq(user.id, deal.ownerId))
      .where(where)
      .orderBy(...sortOrder(SORTS[input.sort], input.dir, deal.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(deal).where(where),
  ]);
  return { rows, total: total?.value ?? 0 };
}

/**
 * What the open deals in the list's view are worth in `base`, rounded to
 * its minor unit: only base amounts converted into `base` count. Null when
 * none does.
 */
async function openValue(
  organizationId: string,
  input: DealListInput,
  base: string,
): Promise<number | null> {
  const [row] = await db
    .select({ value: sql<number | null>`sum(${deal.baseAmount})` })
    .from(deal)
    .where(and(openInView(organizationId, input), countedIn(base)));
  return row?.value == null ? null : roundMoney(Number(row.value), base);
}

/** One deal of the organization, with its company and owner. */
async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select({
      deal,
      company: { ...companyColumns, industry: company.industry },
      owner: ownerColumns,
    })
    .from(deal)
    .innerJoin(company, ofItsCompany)
    .innerJoin(user, eq(user.id, deal.ownerId))
    .where(inOrganization(organizationId, id))
    .limit(1);
  if (!row) return null;
  return { ...row.deal, company: row.company, owner: row.owner };
}

async function insert(values: Omit<typeof deal.$inferInsert, "id">) {
  const [row] = await db
    .insert(deal)
    .values({ ...values, id: crypto.randomUUID() })
    .returning({ id: deal.id, name: deal.name, companyId: deal.companyId });
  if (!row) throw new Error("Deal row missing after insert");
  return row;
}

type DealPatch = Partial<
  Omit<typeof deal.$inferInsert, "id" | "organizationId">
>;

/** The changed deal, or null when it isn't the organization's. */
async function update(organizationId: string, id: string, patch: DealPatch) {
  const [row] = await db
    .update(deal)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(inOrganization(organizationId, id))
    .returning({ id: deal.id, name: deal.name });
  return row ?? null;
}

type StageMove = {
  id: string;
  companyId: string;
  from: DealStage;
  to: DealStage;
  /** Why it closed (or anything said about the move), for its timeline. */
  reason: string | null;
  movedById: string;
};

/**
 * Moves the deal from `from` to `to` and files the move on its timeline (a
 * STAGE_CHANGE activity), in one batch. The move lands only while the deal
 * is still in `from`, so of two people moving it at once one wins, and the
 * loser's activity is taken back out in the same batch. Moving into an
 * outcome stamps when it closed; moving out of one clears it. True when
 * this call moved the deal.
 */
async function moveStage(
  organizationId: string,
  move: StageMove,
): Promise<boolean> {
  const at = new Date().toISOString();
  const closed = isClosedStage(move.to);
  const activityId = crypto.randomUUID();
  await runBatch((tx) => {
    // The deal as this move leaves it, which every later statement needs.
    const moved = tx
      .select({ id: deal.id })
      .from(deal)
      .where(
        and(
          inOrganization(organizationId, move.id),
          eq(deal.stage, move.to),
          eq(deal.stageChangedAt, at),
        ),
      );
    return [
      tx
        .update(deal)
        .set({
          stage: move.to,
          stageChangedAt: at,
          closedAt: closed ? at : null,
          closedReason: closed ? move.reason : null,
          lastActivityAt: at,
          updatedAt: at,
        })
        .where(
          and(
            inOrganization(organizationId, move.id),
            eq(deal.stage, move.from),
          ),
        ),
      tx.insert(activity).values({
        id: activityId,
        organizationId,
        type: "STAGE_CHANGE",
        subject: "Stage changed",
        body: move.reason,
        occurredAt: at,
        companyId: move.companyId,
        dealId: move.id,
        createdById: move.movedById,
        meta: { from: move.from, to: move.to },
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
        .update(company)
        .set({ lastActivityAt: at })
        .where(
          and(
            eq(company.organizationId, organizationId),
            eq(company.id, move.companyId),
            or(isNull(company.lastActivityAt), lt(company.lastActivityAt, at)),
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

/** Archives the live deals among `ids`; the ids it archived. */
async function archive(organizationId: string, ids: string[]) {
  const now = new Date().toISOString();
  const archived: string[] = [];
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(deal)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(deal.organizationId, organizationId),
          inArray(deal.id, part),
          isNull(deal.archivedAt),
        ),
      )
      .returning({ id: deal.id });
    archived.push(...rows.map((row) => row.id));
  }
  return archived;
}

/** Brings an archived deal back; null when it isn't the organization's or isn't archived. */
async function restore(organizationId: string, id: string) {
  const [row] = await db
    .update(deal)
    .set({ archivedAt: null, updatedAt: new Date().toISOString() })
    .where(and(inOrganization(organizationId, id), isNotNull(deal.archivedAt)))
    .returning({ id: deal.id, name: deal.name });
  return row ?? null;
}

/**
 * Permanently deletes an archived deal. Its activities, contacts' links,
 * custom field values and conversations go with it (foreign keys); its
 * company and contacts stay. The agent's rows about it are cleared in the
 * same batch, and the records its activities were also filed on get their
 * last activity restamped. False when nothing was deleted: the deal isn't
 * the organization's, or isn't archived.
 */
async function purge(organizationId: string, id: string): Promise<boolean> {
  const isArchived = and(
    inOrganization(organizationId, id),
    isNotNull(deal.archivedAt),
  );
  const guard = exists(db.select({ id: deal.id }).from(deal).where(isArchived));
  const targets = await activityTargets(
    organizationId,
    eq(activity.dealId, id),
  );
  await runBatch((tx) => [
    ...clearAgentRows(tx, organizationId, (row) => eq(row.dealId, id), guard),
    tx.delete(deal).where(isArchived),
  ]);
  const [left] = await db
    .select({ id: deal.id })
    .from(deal)
    .where(inOrganization(organizationId, id));
  if (left) return false;
  await recomputeLastActivity(organizationId, targets);
  return true;
}

/** Gives `ids` to `ownerId`; how many it changed. */
async function setOwner(
  organizationId: string,
  ids: string[],
  ownerId: string,
) {
  let changed = 0;
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(deal)
      .set({ ownerId, updatedAt: new Date().toISOString() })
      .where(
        and(eq(deal.organizationId, organizationId), inArray(deal.id, part)),
      )
      .returning({ id: deal.id });
    changed += rows.length;
  }
  return changed;
}

export const DealRepository = {
  list,
  openInView,
  openValue,
  findById,
  insert,
  update,
  moveStage,
  archive,
  restore,
  purge,
  setOwner,
};
