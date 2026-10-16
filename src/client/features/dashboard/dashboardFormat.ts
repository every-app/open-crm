import type { getDashboardSummary } from "@/serverFunctions/dashboard";
import type { DealStage } from "@/shared/crm-enums";

export type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;

/** "$4.2K": compact, whole thousands without a decimal. */
export function formatMoneyCompact(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: value % 1000 === 0 ? 0 : 1,
    }).format(value);
  } catch {
    // A currency code Intl doesn't know.
    return `${Math.round(value).toLocaleString()} ${currency}`;
  }
}

const PERCENT = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function formatPercent(rate: number): string {
  return PERCENT.format(rate);
}

/** "1 deal", "3 deals". */
export function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
});

/** "Oct" for "2026-10", a UTC calendar month as the server counts them. */
export function monthLabel(month: string): string {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * The open stages along one blue ramp, lighter early and darker late (the
 * other way round on dark): the order is the meaning. Steps from the chart
 * palette's blue ramp, checked as an ordinal ramp against both card surfaces.
 */
export const STAGE_FILL: Partial<Record<DealStage, string>> = {
  DEMO_BOOKED: "bg-[#86b6ef] dark:bg-[#184f95]",
  QUALIFIED_TO_BUY: "bg-[#5598e7] dark:bg-[#256abf]",
  DECISION_MAKER_BOUGHT_IN: "bg-[#2a78d6] dark:bg-[#3987e5]",
  CONTRACT_SENT: "bg-[#1c5cab] dark:bg-[#6da7ec]",
};
