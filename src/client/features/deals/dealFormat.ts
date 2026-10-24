import type { getDeal, listDeals } from "@/serverFunctions/deals";
import { MAX_DEAL_AMOUNT } from "@/types/schemas/deals";

export type Deal = Awaited<ReturnType<typeof getDeal>>;
export type DealRow = Awaited<ReturnType<typeof listDeals>>["rows"][number];

/** An amount as typed ("24,000.50"), or null when it isn't one a deal takes. */
export function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_DEAL_AMOUNT
    ? amount
    : null;
}

/**
 * "$24,000", or "$24,000.50" when it isn't whole: an amount as written, in
 * the reader's locale.
 */
export function formatAmount(amount: number, currency: string): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    // A currency code Intl doesn't know.
    return `${amount.toLocaleString()} ${currency}`;
  }
}

/** A close date's day (YYYY-MM-DD): the server keeps it as UTC midnight. */
export function closeDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

/** What deleting a deal forever takes with it, for the confirmation. */
export const PURGE_CONSEQUENCE = "Its stage history and notes go too.";
