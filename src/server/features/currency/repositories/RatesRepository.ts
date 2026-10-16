import {
  and,
  asc,
  eq,
  isNull,
  lt,
  max,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { fxRate, manualFxRate, workspace } from "@/db/schema";

// Exchange rates are units of `base_currency` one unit of `quote_currency`
// buys, so an amount in the quote converts as amount × rate. Fetched rates
// (fx_rate) are reference data every organization shares; the rates an
// organization enters by hand (manual_fx_rate) are its own and win.

export type StoredRate = {
  quoteCurrency: string;
  rate: number;
  asOf: string;
  provider: string | null;
};

const storedRate = {
  quoteCurrency: fxRate.quoteCurrency,
  rate: fxRate.rate,
  asOf: fxRate.asOf,
  provider: fxRate.provider,
};

/** The fetched rates quoted against `base`. */
async function listFetched(base: string): Promise<StoredRate[]> {
  return db
    .select(storedRate)
    .from(fxRate)
    .where(eq(fxRate.baseCurrency, base));
}

async function getFetched(
  base: string,
  quote: string,
): Promise<StoredRate | null> {
  const [row] = await db
    .select(storedRate)
    .from(fxRate)
    .where(and(eq(fxRate.baseCurrency, base), eq(fxRate.quoteCurrency, quote)))
    .limit(1);
  return row ?? null;
}

/** When the rates quoted against `base` were last fetched, or null. */
async function lastFetchedAt(base: string): Promise<string | null> {
  const [row] = await db
    .select({ at: max(fxRate.updatedAt) })
    .from(fxRate)
    .where(eq(fxRate.baseCurrency, base));
  return row?.at ?? null;
}

// Rows per upsert: six bound parameters each, well under D1's 100.
const UPSERT_CHUNK = 15;

/**
 * Stores one fetch of the rates quoted against `base`, then drops fetched
 * rates for currencies the CRM doesn't support. Rates entered by hand are
 * never touched.
 */
async function saveFetched(input: {
  base: string;
  rates: { quoteCurrency: string; rate: number }[];
  asOf: string;
  provider: string;
  supported: readonly string[];
}): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const rows = input.rates.map(({ quoteCurrency, rate }) => ({
    baseCurrency: input.base,
    quoteCurrency,
    rate,
    asOf: input.asOf,
    provider: input.provider,
    updatedAt: fetchedAt,
  }));
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
    await db
      .insert(fxRate)
      .values(rows.slice(start, start + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [fxRate.baseCurrency, fxRate.quoteCurrency],
        set: {
          rate: sql`excluded.rate`,
          asOf: sql`excluded.as_of`,
          provider: sql`excluded.provider`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  await db
    .delete(fxRate)
    .where(
      or(
        notInArray(fxRate.baseCurrency, [...input.supported]),
        notInArray(fxRate.quoteCurrency, [...input.supported]),
      ),
    );
}

const manualRate = {
  quoteCurrency: manualFxRate.quoteCurrency,
  rate: manualFxRate.rate,
  asOf: manualFxRate.asOf,
};

/** The rates the organization entered against `base`. */
async function listManual(
  organizationId: string,
  base: string,
): Promise<StoredRate[]> {
  const rows = await db
    .select(manualRate)
    .from(manualFxRate)
    .where(
      and(
        eq(manualFxRate.organizationId, organizationId),
        eq(manualFxRate.baseCurrency, base),
      ),
    );
  return rows.map((row) => ({ ...row, provider: null }));
}

async function getManual(
  organizationId: string,
  base: string,
  quote: string,
): Promise<StoredRate | null> {
  const [row] = await db
    .select(manualRate)
    .from(manualFxRate)
    .where(
      and(
        eq(manualFxRate.organizationId, organizationId),
        eq(manualFxRate.baseCurrency, base),
        eq(manualFxRate.quoteCurrency, quote),
      ),
    )
    .limit(1);
  return row ? { ...row, provider: null } : null;
}

/** Sets the organization's own rate for `quote` against `base`, as of now. */
async function saveManual(
  organizationId: string,
  base: string,
  quote: string,
  rate: number,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(manualFxRate)
    .values({
      organizationId,
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      asOf: now,
    })
    .onConflictDoUpdate({
      target: [
        manualFxRate.organizationId,
        manualFxRate.baseCurrency,
        manualFxRate.quoteCurrency,
      ],
      set: { rate, asOf: now, updatedAt: now },
    });
}

async function removeManual(
  organizationId: string,
  base: string,
  quote: string,
): Promise<void> {
  await db
    .delete(manualFxRate)
    .where(
      and(
        eq(manualFxRate.organizationId, organizationId),
        eq(manualFxRate.baseCurrency, base),
        eq(manualFxRate.quoteCurrency, quote),
      ),
    );
}

/**
 * Organizations whose rates were last refreshed before `before` (or never),
 * longest-waiting first: the daily refresh's work, across organizations.
 */
async function dueForRefresh(before: string, limit: number) {
  return db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(
      or(
        isNull(workspace.ratesRefreshedAt),
        lt(workspace.ratesRefreshedAt, before),
      ),
    )
    .orderBy(asc(sql`coalesce(${workspace.ratesRefreshedAt}, '')`))
    .limit(limit);
}

export const RatesRepository = {
  listFetched,
  getFetched,
  lastFetchedAt,
  saveFetched,
  listManual,
  getManual,
  saveManual,
  removeManual,
  dueForRefresh,
};
