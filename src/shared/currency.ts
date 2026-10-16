// The currencies the CRM converts between and how precise each one's amounts
// are, shared by deals (an amount is rounded to its currency's minor unit when
// it is written), the reporting-currency conversion
// (src/server/features/currency) and Settings → Currencies.

/**
 * Every currency the CRM supports, in picker order. This list is the one gate
 * for the reporting-currency picker, the rate feed and every stored code.
 */
export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "HKD",
  "SGD",
  "ZAR",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

const DETAILS: Record<CurrencyCode, { name: string; minorUnits: number }> = {
  USD: { name: "US Dollar", minorUnits: 2 },
  EUR: { name: "Euro", minorUnits: 2 },
  JPY: { name: "Japanese Yen", minorUnits: 0 },
  GBP: { name: "Pound Sterling", minorUnits: 2 },
  CNY: { name: "Chinese Yuan", minorUnits: 2 },
  AUD: { name: "Australian Dollar", minorUnits: 2 },
  CAD: { name: "Canadian Dollar", minorUnits: 2 },
  CHF: { name: "Swiss Franc", minorUnits: 2 },
  HKD: { name: "Hong Kong Dollar", minorUnits: 2 },
  SGD: { name: "Singapore Dollar", minorUnits: 2 },
  ZAR: { name: "South African Rand", minorUnits: 2 },
};

export const CURRENCIES = CURRENCY_CODES.map((code) => ({
  code,
  ...DETAILS[code],
}));

/** What deal totals are reported in until a workspace picks another. */
export const DEFAULT_REPORTING_CURRENCY: CurrencyCode = "USD";

/** A code as stored and compared: trimmed and uppercased. */
export function normalizeCurrency(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** The supported currency `value` names, or null. */
export function toCurrencyCode(
  value: string | null | undefined,
): CurrencyCode | null {
  const code = normalizeCurrency(value);
  return CURRENCY_CODES.find((supported) => supported === code) ?? null;
}

export function currencyName(value: string | null | undefined): string | null {
  const code = toCurrencyCode(value);
  return code ? DETAILS[code].name : null;
}

/** Decimal places an amount in `value` carries: 2 unless the currency says. */
export function minorUnitsOf(value: string | null | undefined): number {
  const code = toCurrencyCode(value);
  return code ? DETAILS[code].minorUnits : 2;
}

/**
 * `value` rounded half away from zero at `places`, as SQL's round() does.
 * The shift goes through the decimal string, so 1.005 rounds to 1.01 as it
 * reads, not to 1.00 as its binary value would.
 */
function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) return value;
  const magnitude = Math.abs(value);
  const shifted = Number(`${magnitude}e${places}`);
  // Exponent notation (very large or tiny values) has no decimal string to
  // shift; plain arithmetic is exact enough there.
  const rounded = Number.isNaN(shifted)
    ? Math.round(magnitude * 10 ** places) / 10 ** places
    : Number(`${Math.round(shifted)}e-${places}`);
  return value < 0 ? -rounded : rounded;
}

/** An amount rounded to its currency's minor unit, as money is written. */
export function roundMoney(amount: number, currency: string): number {
  return roundTo(amount, minorUnitsOf(currency));
}

/** An exchange rate rounded as it is stored: ten decimal places. */
export function roundRate(rate: number): number {
  return roundTo(rate, 10);
}
