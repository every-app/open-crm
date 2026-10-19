import { sortBy } from "remeda";
import { DealConversionRepository } from "@/server/features/currency/repositories/DealConversionRepository";
import {
  RatesRepository,
  type StoredRate,
} from "@/server/features/currency/repositories/RatesRepository";
import { ConversionService } from "@/server/features/currency/services/ConversionService";
import {
  RATES_PROVIDER,
  RATES_REFRESH_INTERVAL_MS,
  RatesService,
} from "@/server/features/currency/services/RatesService";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { AppError } from "@/server/lib/errors";
import {
  DEFAULT_REPORTING_CURRENCY,
  currencyName,
  roundRate,
  toCurrencyCode,
  type CurrencyCode,
} from "@/shared/currency";

type RateSource = "FETCHED" | "MANUAL";

export type CurrencyRate = {
  currency: string;
  name: string | null;
  /** Units of the reporting currency one unit of `currency` buys. */
  rate: number;
  asOf: string;
  source: RateSource;
  provider: string | null;
};

export type CurrencySettings = {
  reportingCurrency: CurrencyCode;
  /** When the organization's rates were last refreshed. */
  refreshedAt: string | null;
  /** The rate each currency converts at now: a hand-entered one wins. */
  rates: CurrencyRate[];
  /** The currencies the organization's deals are in, most used first. */
  inUse: {
    currency: string;
    name: string | null;
    deals: number;
    convertible: boolean;
  }[];
  unconverted: { count: number; currencies: string[] };
};

/** Settings → Currencies: what totals are in, at which rates, and the gaps. */
async function getSettings(organizationId: string): Promise<CurrencySettings> {
  const reportingCurrency =
    await ConversionService.reportingCurrency(organizationId);
  const [workspace, fetched, manual, usage, unconverted] = await Promise.all([
    WorkspaceRepository.getOrCreate(organizationId),
    RatesRepository.listFetched(reportingCurrency),
    RatesRepository.listManual(organizationId, reportingCurrency),
    DealConversionRepository.countByCurrency(organizationId),
    ConversionService.unconverted(organizationId),
  ]);

  const effective = new Map<string, CurrencyRate>();
  for (const rate of fetched) {
    effective.set(rate.quoteCurrency, toCurrencyRate(rate, "FETCHED"));
  }
  for (const rate of manual) {
    effective.set(rate.quoteCurrency, toCurrencyRate(rate, "MANUAL"));
  }
  const convertible = new Set([reportingCurrency, ...effective.keys()]);

  return {
    reportingCurrency,
    refreshedAt: workspace.ratesRefreshedAt,
    rates: sortBy([...effective.values()], (rate) => rate.currency),
    inUse: usage.map((row) => ({
      currency: row.currency,
      name: currencyName(row.currency),
      deals: row.deals,
      convertible: convertible.has(row.currency),
    })),
    unconverted,
  };
}

function toCurrencyRate(rate: StoredRate, source: RateSource): CurrencyRate {
  return {
    currency: rate.quoteCurrency,
    name: currencyName(rate.quoteCurrency),
    rate: rate.rate,
    asOf: rate.asOf,
    source,
    provider: rate.provider,
  };
}

/**
 * Reports every total in `currency` from now on: fetches its rates and
 * converts every deal again at them. Figures already reported move.
 */
async function setReportingCurrency(
  organizationId: string,
  currency: CurrencyCode,
): Promise<CurrencySettings> {
  const current = await ConversionService.reportingCurrency(organizationId);
  if (currency === current) return getSettings(organizationId);

  await WorkspaceRepository.update(organizationId, {
    reportingCurrency: currency,
  });
  // An unreachable feed doesn't stop the change: hand-entered rates still
  // convert, and the daily refresh fills in the rest.
  const fetched = await RatesService.ensureFresh(currency);
  if (fetched) {
    await WorkspaceRepository.update(organizationId, {
      ratesRefreshedAt: new Date().toISOString(),
    });
  }
  const rerated = await ConversionService.rerateAll(organizationId);
  console.log("[currency] reporting currency changed", {
    organizationId,
    from: current,
    to: currency,
    ratesFetched: fetched,
    ...rerated,
  });
  return getSettings(organizationId);
}

/**
 * Sets the organization's own rate for `currency`, which wins over the
 * fetched one, and converts the deals no rate converted yet. Deals already
 * converted keep the rate they were saved at.
 */
async function setManualRate(
  organizationId: string,
  currency: CurrencyCode,
  rate: number,
): Promise<CurrencySettings> {
  const base = await ConversionService.reportingCurrency(organizationId);
  if (currency === base) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${base} is the reporting currency: its rate is always 1.`,
    );
  }
  await RatesRepository.saveManual(
    organizationId,
    base,
    currency,
    roundRate(rate),
  );
  const filled = await ConversionService.fillMissing(organizationId);
  console.log("[currency] manual exchange rate saved", {
    organizationId,
    base,
    currency,
    converted: filled.converted,
  });
  return getSettings(organizationId);
}

/** Drops the organization's own rate for `currency`; the fetched one applies. */
async function removeManualRate(
  organizationId: string,
  currency: CurrencyCode,
): Promise<CurrencySettings> {
  const base = await ConversionService.reportingCurrency(organizationId);
  await RatesRepository.removeManual(organizationId, base, currency);
  console.log("[currency] manual exchange rate removed", {
    organizationId,
    base,
    currency,
  });
  return getSettings(organizationId);
}

/**
 * Takes the feed's latest rates (fetching them when it has published since
 * they were fetched) and converts the deals no rate converted yet.
 */
async function refreshRates(organizationId: string): Promise<CurrencySettings> {
  const base = await ConversionService.reportingCurrency(organizationId);
  if (!(await RatesService.ensureFresh(base))) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Could not reach ${RATES_PROVIDER}. Rates entered by hand are unaffected.`,
    );
  }
  await refreshed(organizationId);
  return getSettings(organizationId);
}

async function refreshed(organizationId: string) {
  await ConversionService.fillMissing(organizationId);
  await WorkspaceRepository.update(organizationId, {
    ratesRefreshedAt: new Date().toISOString(),
  });
}

/**
 * The hourly refresh, across organizations, for the cron. First the rates
 * against each currency organizations report in are fetched, if the feed
 * has published since they last were. Then each organization whose rates
 * were last refreshed a day ago (or never) converts the deals no rate
 * converted yet: at most `limit` a call, longest-waiting first. A feed that
 * can't be reached leaves its organizations due for the next call.
 */
async function refreshDueRates(
  limit = 500,
): Promise<{ refreshed: number; failed: number }> {
  // One fetch per base currency per call.
  const freshBases = new Map<string, boolean>();
  for (const code of await RatesRepository.reportingCurrencies()) {
    const base = toCurrencyCode(code) ?? DEFAULT_REPORTING_CURRENCY;
    if (freshBases.has(base)) continue;
    freshBases.set(base, await RatesService.ensureFresh(base));
  }
  const due = await RatesRepository.dueForRefresh(
    new Date(Date.now() - RATES_REFRESH_INTERVAL_MS).toISOString(),
    limit,
  );
  let refreshedCount = 0;
  let failed = 0;
  for (const { organizationId } of due) {
    try {
      const base = await ConversionService.reportingCurrency(organizationId);
      const fresh =
        freshBases.get(base) ?? (await RatesService.ensureFresh(base));
      freshBases.set(base, fresh);
      if (!fresh) {
        failed += 1;
        continue;
      }
      await refreshed(organizationId);
      refreshedCount += 1;
    } catch (error) {
      console.error(
        "[currency] could not refresh an organization's rates",
        { organizationId },
        error,
      );
      failed += 1;
    }
  }
  if (due.length > 0) {
    console.log("[currency] daily rate refresh", {
      due: due.length,
      refreshed: refreshedCount,
      failed,
    });
  }
  return { refreshed: refreshedCount, failed };
}

export const CurrencyService = {
  getSettings,
  setReportingCurrency,
  setManualRate,
  removeManualRate,
  refreshRates,
  refreshDueRates,
};
