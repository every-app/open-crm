import { and, type SQL } from "drizzle-orm";
import { sort } from "remeda";
import {
  DealConversionRepository,
  countedIn,
  pendingIn,
} from "@/server/features/currency/repositories/DealConversionRepository";
import { RatesRepository } from "@/server/features/currency/repositories/RatesRepository";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import {
  DEFAULT_REPORTING_CURRENCY,
  minorUnitsOf,
  normalizeCurrency,
  roundMoney,
  toCurrencyCode,
  type CurrencyCode,
} from "@/shared/currency";

// How a deal amount becomes a figure in the organization's reporting
// currency (the CRM's docs/currency.md). The rate is resolved once, when the
// deal is saved, and frozen on the deal: converting on read would make a
// closed quarter change value every morning. A missing rate leaves the base
// amount null, disclosed (`unconverted`) rather than counted as zero.

type ResolvedRate = { rate: number; asOf: string };

/** What a deal stores beside its amount, frozen when the deal is saved. */
export type DealFxFields = {
  baseAmount: number | null;
  baseCurrency: string | null;
  fxRate: number | null;
  fxRateAt: string | null;
};

type RerateResult = {
  converted: number;
  cleared: number;
  /** Currencies with deals and no rate into the reporting currency. */
  missing: string[];
};

/** The currency the organization's deal totals are reported in. */
async function reportingCurrency(
  organizationId: string,
): Promise<CurrencyCode> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return toCurrencyCode(row.reportingCurrency) ?? DEFAULT_REPORTING_CURRENCY;
}

/**
 * The rate that converts `quote` into `base` for the organization: 1 for the
 * same currency, else its own rate, else the fetched one. Null when there is
 * none (or it isn't positive).
 */
async function resolveRate(
  organizationId: string,
  base: string,
  quote: string,
): Promise<ResolvedRate | null> {
  const baseCurrency = normalizeCurrency(base);
  const quoteCurrency = normalizeCurrency(quote);
  if (!baseCurrency || !quoteCurrency) return null;
  if (baseCurrency === quoteCurrency) {
    return { rate: 1, asOf: new Date().toISOString() };
  }

  const manual = await RatesRepository.getManual(
    organizationId,
    baseCurrency,
    quoteCurrency,
  );
  const chosen =
    manual ?? (await RatesRepository.getFetched(baseCurrency, quoteCurrency));
  if (!chosen || !(chosen.rate > 0)) return null;
  return { rate: chosen.rate, asOf: chosen.asOf };
}

/**
 * A deal amount in the organization's reporting currency, for the deal to
 * store when it is created or its amount or currency changes. Every field is
 * null when there is no amount or no rate converts its currency.
 */
async function dealFields(
  organizationId: string,
  amount: number | null,
  currency: string,
): Promise<DealFxFields> {
  if (amount === null) return NO_CONVERSION;
  const base = await reportingCurrency(organizationId);
  const rate = await resolveRate(organizationId, base, currency);
  if (!rate) return NO_CONVERSION;
  return {
    baseAmount: roundMoney(amount * rate.rate, base),
    baseCurrency: base,
    fxRate: rate.rate,
    fxRateAt: rate.asOf,
  };
}

const NO_CONVERSION: DealFxFields = {
  baseAmount: null,
  baseCurrency: null,
  fxRate: null,
  fxRateAt: null,
};

/**
 * The organization's deals with an amount left out of totals in its
 * reporting currency, and their currencies, for "3 deals in CHF are not
 * included". `where` narrows them, as a total's own filter does.
 */
async function unconverted(
  organizationId: string,
  where?: SQL,
): Promise<{ count: number; currencies: string[] }> {
  const base = await reportingCurrency(organizationId);
  const rows = await DealConversionRepository.countByCurrency(
    organizationId,
    and(pendingIn(base), where),
  );
  return {
    count: rows.reduce((total, row) => total + row.deals, 0),
    currencies: byCode(rows.map((row) => row.currency)),
  };
}

const byCode = (codes: string[]) => sort(codes, (a, b) => a.localeCompare(b));

/**
 * Converts every deal with an amount again into the reporting currency: the
 * one thing that overwrites a frozen rate, on a reporting-currency change.
 * Deals whose currency has no rate are cleared, so they drop out of totals
 * instead of counting in the old currency.
 */
async function rerateAll(organizationId: string): Promise<RerateResult> {
  return rerate(organizationId, false);
}

/** Converts the deals no rate converted yet. Never touches a converted deal. */
async function fillMissing(organizationId: string): Promise<RerateResult> {
  return rerate(organizationId, true);
}

async function rerate(
  organizationId: string,
  onlyMissing: boolean,
): Promise<RerateResult> {
  const base = await reportingCurrency(organizationId);
  const groups = await DealConversionRepository.countByCurrency(
    organizationId,
    onlyMissing ? pendingIn(base) : undefined,
  );
  let converted = 0;
  let cleared = 0;
  const missing: string[] = [];
  // Grouped by the trimmed, uppercased code, so ` usd ` and `USD` are one.
  for (const { currency } of groups) {
    const rate = await resolveRate(organizationId, base, currency);
    if (!rate) {
      missing.push(currency);
      if (!onlyMissing) {
        cleared += await DealConversionRepository.clear(
          organizationId,
          currency,
        );
      }
      continue;
    }
    converted += await DealConversionRepository.convert(organizationId, {
      base,
      currency,
      rate: rate.rate,
      rateAt: rate.asOf,
      places: minorUnitsOf(base),
      onlyMissing,
    });
  }
  return { converted, cleared, missing: byCode(missing) };
}

export const ConversionService = {
  reportingCurrency,
  dealFields,
  unconverted,
  rerateAll,
  fillMissing,
  countedIn,
  pendingIn,
};
