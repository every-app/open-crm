import {
  and,
  asc,
  count,
  desc,
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
import { company, contact, deal, user } from "@/db/schema";
import { countedIn } from "@/server/features/currency/repositories/DealConversionRepository";
import { OPEN_DEAL_STAGES } from "@/shared/deal-stages";

// The deal figures behind Home. Money only ever adds up base amounts counted
// in the reporting currency (DealConversionRepository's countedIn); counts
// take every deal. Archived deals stay out of every figure, as they stay out
// of every list. Days compare as text: a date-only bound ("2026-10-01")
// orders before every timestamp of that day.

/** Whose deals: the organization's live ones, or one owner's of them. */
export type DealScope = { organizationId: string; ownerId: string | null };

export function dealsInScope(scope: DealScope): SQL {
  return (
    and(
      eq(deal.organizationId, scope.organizationId),
      isNull(deal.archivedAt),
      scope.ownerId ? eq(deal.ownerId, scope.ownerId) : undefined,
    ) ?? sql`false`
  );
}

/** Open deals by stage: how many, and what those counted in `base` add up to. */
async function openByStage(scope: DealScope, base: string) {
  return db
    .select({
      stage: deal.stage,
      deals: count(),
      value:
        sql<number>`coalesce(sum(case when ${countedIn(base)} then ${deal.baseAmount} end), 0)`.mapWith(
          Number,
        ),
    })
    .from(deal)
    .where(and(dealsInScope(scope), inArray(deal.stage, OPEN_DEAL_STAGES)))
    .groupBy(deal.stage);
}

/** Deals created or closed on or after `since`: the trend and the rates. */
async function createdOrClosedSince(scope: DealScope, since: string) {
  return db
    .select({
      stage: deal.stage,
      baseAmount: deal.baseAmount,
      baseCurrency: deal.baseCurrency,
      createdAt: deal.createdAt,
      closedAt: deal.closedAt,
    })
    .from(deal)
    .where(
      and(
        dealsInScope(scope),
        or(gte(deal.createdAt, since), gte(deal.closedAt, since)),
      ),
    );
}

/** Open deals counted in `base` expected to close on a day in [from, to). */
async function closingBetween(
  scope: DealScope,
  base: string,
  from: string,
  to: string,
) {
  const [row] = await db
    .select({
      deals: count(),
      value: sql<number>`coalesce(sum(${deal.baseAmount}), 0)`.mapWith(Number),
    })
    .from(deal)
    .where(
      and(
        dealsInScope(scope),
        inArray(deal.stage, OPEN_DEAL_STAGES),
        gte(deal.expectedCloseDate, from),
        lt(deal.expectedCloseDate, to),
        countedIn(base),
      ),
    );
  return row ?? { deals: 0, value: 0 };
}

/**
 * The biggest open deals by their value in `base`, soonest close breaking
 * ties. A deal not counted in `base` has no value here and comes last, so a
 * stale figure never takes a place.
 */
async function biggestOpen(scope: DealScope, base: string, limit: number) {
  const value = sql<
    number | null
  >`case when ${countedIn(base)} then ${deal.baseAmount} end`;
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      baseAmount: value,
      expectedCloseDate: deal.expectedCloseDate,
      stageChangedAt: deal.stageChangedAt,
      companyId: company.id,
      companyName: company.name,
      iconUrl: company.iconUrl,
      iconDarkUrl: company.iconDarkUrl,
      iconTone: company.iconTone,
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerImage: user.image,
    })
    .from(deal)
    .innerJoin(
      company,
      and(
        eq(company.id, deal.companyId),
        eq(company.organizationId, deal.organizationId),
      ),
    )
    .innerJoin(user, eq(user.id, deal.ownerId))
    .where(and(dealsInScope(scope), inArray(deal.stage, OPEN_DEAL_STAGES)))
    .orderBy(
      sql`(${value} is null)`,
      desc(value),
      sql`(${deal.expectedCloseDate} is null)`,
      asc(deal.expectedCloseDate),
      asc(deal.id),
    )
    .limit(limit);
  return rows.map(
    ({
      companyId,
      companyName,
      iconUrl,
      iconDarkUrl,
      iconTone,
      ownerId,
      ownerName,
      ownerEmail,
      ownerImage,
      ...row
    }) => ({
      ...row,
      company: {
        id: companyId,
        name: companyName,
        iconUrl,
        iconDarkUrl,
        iconTone,
      },
      owner: {
        id: ownerId,
        name: ownerName,
        email: ownerEmail,
        image: ownerImage,
      },
    }),
  );
}

/** Whether the organization has any live company, contact or deal yet. */
async function hasRecords(organizationId: string): Promise<boolean> {
  const live = (table: typeof company | typeof contact | typeof deal) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(
        and(eq(table.organizationId, organizationId), isNull(table.archivedAt)),
      )
      .limit(1);
  const found = await Promise.all([live(company), live(contact), live(deal)]);
  return found.some((rows) => rows.length > 0);
}

export const DashboardRepository = {
  hasRecords,
  openByStage,
  createdOrClosedSince,
  closingBetween,
  biggestOpen,
};
