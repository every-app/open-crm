import { and, count, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema";

// A deal's amount in the organization's reporting currency. `amount` and
// `currency` are what the customer pays and are never converted in place;
// `base_amount` is the only figure a total, chart, average or sort may add
// up, `base_currency` says what it is in (so a figure converted against an
// old reporting currency can't pass for a current one), and `fx_rate` /
// `fx_rate_at` record how it got there. Every write of `base_amount` writes
// `base_currency` in the same statement.

// Codes compared as stored ones are: trimmed and uppercased.
const dealCurrency = sql<string>`upper(trim(${deal.currency}))`;

/**
 * Deals whose base amount counts in `base`: filter every money aggregate
 * with it. Counts are not filtered by it.
 */
export function countedIn(base: string): SQL {
  return sql`(${deal.baseAmount} is not null and ${deal.baseCurrency} = ${base})`;
}

/**
 * Deals with an amount that isn't in `base` yet: no base amount, or one in
 * another currency. Null matches explicitly: `base_currency <> base` is
 * null, not true, for a deal never converted.
 */
export function pendingIn(base: string): SQL {
  return sql`(${deal.amount} is not null and (${deal.baseAmount} is null or ${deal.baseCurrency} is null or ${deal.baseCurrency} <> ${base}))`;
}

/** How many deals with an amount each currency has, most first. */
async function countByCurrency(organizationId: string, where?: SQL) {
  return db
    .select({ currency: dealCurrency, deals: count() })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNotNull(deal.amount),
        where,
      ),
    )
    .groupBy(dealCurrency)
    .orderBy(desc(count()), dealCurrency);
}

/**
 * Converts the organization's deals in `currency` into `base` at `rate`:
 * only those not in `base` yet when `onlyMissing`, else every one. The
 * number of deals written.
 */
async function convert(
  organizationId: string,
  input: {
    base: string;
    currency: string;
    rate: number;
    rateAt: string;
    /** The base currency's minor unit: the places base amounts round to. */
    places: number;
    onlyMissing: boolean;
  },
): Promise<number> {
  // Rounds in SQL. `places` is a trusted small integer.
  const baseAmount = sql<number>`round(cast(${deal.amount} * ${input.rate} as numeric), ${sql.raw(String(Math.trunc(input.places)))})`;
  const rows = await db
    .update(deal)
    .set({
      baseAmount,
      baseCurrency: input.base,
      fxRate: input.rate,
      fxRateAt: input.rateAt,
    })
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNotNull(deal.amount),
        sql`${dealCurrency} = ${input.currency}`,
        input.onlyMissing ? pendingIn(input.base) : undefined,
      ),
    )
    .returning({ id: deal.id });
  return rows.length;
}

/**
 * Clears the base amounts of the organization's deals in `currency`: no rate
 * converts them into the reporting currency any more. The number cleared.
 */
async function clear(organizationId: string, currency: string) {
  const rows = await db
    .update(deal)
    .set({ baseAmount: null, baseCurrency: null, fxRate: null, fxRateAt: null })
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNotNull(deal.baseAmount),
        sql`${dealCurrency} = ${currency}`,
      ),
    )
    .returning({ id: deal.id });
  return rows.length;
}

export const DealConversionRepository = {
  countByCurrency,
  convert,
  clear,
};
