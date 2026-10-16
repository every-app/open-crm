import { z } from "zod";
import { RatesRepository } from "@/server/features/currency/repositories/RatesRepository";
import { CURRENCY_CODES, roundRate, toCurrencyCode } from "@/shared/currency";

// The rate feed: open.er-api.com, keyless, which publishes once a day. Its
// rates are reference data: one fetch per base currency serves every
// organization that reports in it (fx_rate), so a base is fetched at most
// about once a day however many organizations refresh.

export const RATES_PROVIDER = "open.er-api.com";

const RATES_URL = "https://open.er-api.com/v6/latest";
const RATES_TIMEOUT_MS = 6_000;
const RATES_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

/**
 * How long fetched rates (and an organization's refresh) last: about a day.
 * Under 24 hours, so a refresh run every hour doesn't slip an hour a day by
 * finding them a few seconds short of a day old.
 */
export const RATES_REFRESH_INTERVAL_MS = 23 * 60 * 60 * 1000;

const UNREADABLE_FEED = {
  result: "",
  time_last_update_unix: null,
  rates: {},
  "error-type": null,
};

const feedResponse = z
  .object({
    result: z.string().catch(""),
    time_last_update_unix: z.number().nullable().catch(null),
    rates: z.record(z.string(), z.unknown()).catch({}),
    "error-type": z.string().nullable().catch(null),
  })
  .catch(UNREADABLE_FEED);

type FetchedRates = {
  rates: { quoteCurrency: string; rate: number }[];
  asOf: string;
};

/**
 * Makes sure the rates quoted against `base` were fetched within the last
 * day, fetching them when they weren't. False when the feed couldn't be
 * reached; rates already stored (and those entered by hand) stay as they
 * were.
 */
async function ensureFresh(base: string): Promise<boolean> {
  const lastFetchedAt = await RatesRepository.lastFetchedAt(base);
  if (
    lastFetchedAt &&
    Date.now() - Date.parse(lastFetchedAt) < RATES_REFRESH_INTERVAL_MS
  ) {
    return true;
  }
  const fetched = await fetchRates(base);
  if (!fetched) return false;
  await RatesRepository.saveFetched({
    base,
    rates: fetched.rates,
    asOf: fetched.asOf,
    provider: RATES_PROVIDER,
    supported: CURRENCY_CODES,
  });
  console.log("[currency] exchange rates fetched", {
    base,
    rates: fetched.rates.length,
    asOf: fetched.asOf,
  });
  return true;
}

async function fetchRates(base: string): Promise<FetchedRates | null> {
  for (let attempt = 1; attempt <= RATES_ATTEMPTS; attempt += 1) {
    const fetched = await attemptFetch(base, attempt);
    if (fetched) return fetched;
    if (attempt < RATES_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

async function attemptFetch(
  base: string,
  attempt: number,
): Promise<FetchedRates | null> {
  try {
    const response = await fetch(`${RATES_URL}/${encodeURIComponent(base)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn("[currency] exchange rate request failed", {
        status: response.status,
        base,
        attempt,
      });
      return null;
    }
    const body = feedResponse.parse(await response.json());
    // An unsupported base answers 200 with {"result":"error"}, so the
    // status alone says nothing.
    if (body.result !== "success") {
      console.warn("[currency] the rate feed refused the request", {
        base,
        attempt,
        errorType: body["error-type"],
      });
      return null;
    }

    const rates: FetchedRates["rates"] = [];
    for (const [code, value] of Object.entries(body.rates)) {
      const quoteCurrency = toCurrencyCode(code);
      if (!quoteCurrency || quoteCurrency === base) continue;
      const perBase = Number(value);
      if (!Number.isFinite(perBase) || perBase <= 0) continue;
      // The feed says how many `quote` one `base` buys; a stored rate is
      // how many `base` one `quote` buys.
      rates.push({ quoteCurrency, rate: roundRate(1 / perBase) });
    }
    if (rates.length === 0) {
      console.warn("[currency] the rate feed carried no usable rates", {
        base,
        attempt,
      });
      return null;
    }
    return { rates, asOf: feedTime(body.time_last_update_unix) };
  } catch (error) {
    console.warn("[currency] exchange rates unavailable", {
      base,
      attempt,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** When the feed last updated, or now when it doesn't say. */
function feedTime(seconds: number | null): string {
  const date = new Date(seconds === null ? Date.now() : seconds * 1000);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

export const RatesService = {
  ensureFresh,
};
