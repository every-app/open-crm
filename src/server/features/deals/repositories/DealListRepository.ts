import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { company, deal, user } from "@/db/schema";
import { countedIn } from "@/server/features/currency/repositories/DealConversionRepository";
import {
  dealCompanyColumns,
  dealOwnerColumns,
  ofItsCompany,
} from "@/server/features/deals/repositories/DealRepository";
import {
  archivedCondition,
  ownerCondition,
  pageWindow,
  searchCondition,
  sortOrder,
  type SortSpec,
} from "@/server/features/records/listQuery";
import { roundMoney } from "@/shared/currency";
import {
  CLOSED_DEAL_STAGES,
  DEAL_STAGE_ORDER,
  OPEN_DEAL_STAGES,
} from "@/shared/deal-stages";
import type {
  ClosingWindow,
  DealListInput,
  DealSort,
} from "@/types/schemas/deals";

// The deals list: its search, filters, order and page, and what the open
// deals in its view are worth. The filters name only the deal's own columns,
// so a total over the view needs no join.

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
 * The list's view: everything but its page and order, `fieldConditions`
 * being its custom field filters' conditions on `deal`. It names only the
 * deal's own columns, so totals over the view need no join.
 */
function listWhere(
  organizationId: string,
  input: DealListInput,
  fieldConditions: SQL[],
) {
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
    ...fieldConditions,
  );
}

/** The open deals in the list's view: what its pipeline total adds up. */
function openInView(
  organizationId: string,
  input: DealListInput,
  fieldConditions: SQL[],
) {
  return and(
    listWhere(organizationId, input, fieldConditions),
    inArray(deal.stage, OPEN_DEAL_STAGES),
  );
}

async function list(
  organizationId: string,
  input: DealListInput,
  fieldConditions: SQL[],
) {
  const where = listWhere(organizationId, input, fieldConditions);
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
        company: dealCompanyColumns,
        owner: dealOwnerColumns,
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
  fieldConditions: SQL[],
  base: string,
): Promise<number | null> {
  const [row] = await db
    .select({ value: sql<number | null>`sum(${deal.baseAmount})` })
    .from(deal)
    .where(
      and(openInView(organizationId, input, fieldConditions), countedIn(base)),
    );
  return row?.value == null ? null : roundMoney(Number(row.value), base);
}

export const DealListRepository = {
  list,
  openInView,
  openValue,
};
