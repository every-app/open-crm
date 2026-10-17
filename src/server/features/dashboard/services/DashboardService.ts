import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { ConversionService } from "@/server/features/currency/services/ConversionService";
import {
  DashboardRepository,
  dealsInScope,
  type DealScope,
} from "@/server/features/dashboard/repositories/DashboardRepository";
import { roundMoney } from "@/shared/currency";
import type { DealStage } from "@/shared/crm-enums";
import { OPEN_DEAL_STAGES } from "@/shared/deal-stages";
import type { DashboardScope } from "@/types/schemas/dashboard";

// Home: what the viewer (or the whole team) has closed, what is still in
// play, and what needs them today. Money is in the workspace's reporting
// currency and adds up only the deals converted into it; the rest are
// disclosed as `unconverted`. Months are calendar months in UTC.

const TREND_MONTHS = 6;
const RATE_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const BIGGEST_OPEN = 6;
const OVERDUE_TASKS = 10;
const RECENT_ACTIVITY = 12;

/** "2026-10": the UTC month `offset` months from `now`'s. */
function monthOf(now: Date, offset: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

type Total = { count: number; value: number };

type DealHistoryRow = {
  stage: DealStage;
  baseAmount: number | null;
  baseCurrency: string | null;
  createdAt: string;
  closedAt: string | null;
};

/**
 * The trend (won and new pipeline by month), the wins of this month and the
 * last, and the win rate, average deal and cycle over the rate window. A
 * win with no value in `base` counts as a win but stays out of the average.
 */
function dealHistory(
  rows: DealHistoryRow[],
  window: {
    base: string;
    months: string[];
    thisMonth: string;
    lastMonth: string;
    rateStart: string;
  },
) {
  const trend = window.months.map((month) => ({ month, won: 0, created: 0 }));
  const byMonth = new Map(trend.map((point) => [point.month, point]));
  const wonThisMonth: Total = { count: 0, value: 0 };
  const wonLastMonth: Total = { count: 0, value: 0 };
  let wins = 0;
  let losses = 0;
  let valuedWins = 0;
  let wonValue = 0;
  let cycleDays = 0;

  for (const row of rows) {
    const valued =
      row.baseCurrency === window.base && row.baseAmount !== null
        ? row.baseAmount
        : null;
    const created = byMonth.get(row.createdAt.slice(0, 7));
    if (created) created.created += valued ?? 0;
    if (!row.closedAt) continue;
    const won = row.stage === "CLOSED_WON";
    const closedMonth = row.closedAt.slice(0, 7);
    if (won) {
      const closed = byMonth.get(closedMonth);
      if (closed) closed.won += valued ?? 0;
      const total =
        closedMonth === window.thisMonth
          ? wonThisMonth
          : closedMonth === window.lastMonth
            ? wonLastMonth
            : null;
      if (total) {
        total.count += 1;
        total.value += valued ?? 0;
      }
    }
    if (row.closedAt < window.rateStart) continue;
    if (won) {
      wins += 1;
      if (valued !== null) {
        valuedWins += 1;
        wonValue += valued;
      }
      cycleDays +=
        (Date.parse(row.closedAt) - Date.parse(row.createdAt)) / DAY_MS;
    } else if (row.stage === "CLOSED_LOST") {
      losses += 1;
    }
  }

  const money = (value: number) => roundMoney(value, window.base);
  return {
    trend: trend.map((point) => ({
      month: point.month,
      won: money(point.won),
      created: money(point.created),
    })),
    wonThisMonth: { ...wonThisMonth, value: money(wonThisMonth.value) },
    wonLastMonth: { ...wonLastMonth, value: money(wonLastMonth.value) },
    performance: {
      windowDays: RATE_WINDOW_DAYS,
      wins,
      losses,
      winRate: wins + losses === 0 ? null : wins / (wins + losses),
      averageDeal: valuedWins === 0 ? null : money(wonValue / valuedWins),
      averageCycleDays: wins === 0 ? null : Math.round(cycleDays / wins),
    },
  };
}

/** Home's figures and lists, for the viewer's own deals or everyone's. */
async function summary(
  organizationId: string,
  userId: string,
  scope: DashboardScope,
) {
  const now = new Date();
  const mine = scope === "me";
  const deals: DealScope = { organizationId, ownerId: mine ? userId : null };
  const months = Array.from({ length: TREND_MONTHS }, (_, index) =>
    monthOf(now, index - (TREND_MONTHS - 1)),
  );
  const thisMonth = monthOf(now, 0);
  const base = await ConversionService.reportingCurrency(organizationId);

  const [
    byStage,
    history,
    closingThisMonth,
    biggestOpen,
    overdueTasks,
    recentActivity,
    unconverted,
  ] = await Promise.all([
    DashboardRepository.openByStage(deals, base),
    DashboardRepository.createdOrClosedSince(deals, `${months[0]}-01`),
    DashboardRepository.closingBetween(
      deals,
      base,
      `${thisMonth}-01`,
      `${monthOf(now, 1)}-01`,
    ),
    DashboardRepository.biggestOpen(deals, base, BIGGEST_OPEN),
    // Tasks are always the viewer's own.
    ActivityRepository.openTasks(organizationId, {
      userId,
      window: "overdue",
      limit: OVERDUE_TASKS,
      now: now.toISOString(),
    }),
    ActivityRepository.recent(organizationId, {
      createdById: mine ? userId : null,
      limit: RECENT_ACTIVITY,
    }),
    ConversionService.unconverted(organizationId, dealsInScope(deals)),
  ]);

  const stages = OPEN_DEAL_STAGES.map((stage) => {
    const row = byStage.find((candidate) => candidate.stage === stage);
    return {
      stage,
      count: row?.deals ?? 0,
      value: roundMoney(row?.value ?? 0, base),
    };
  });

  return {
    scope,
    reportingCurrency: base,
    unconverted,
    pipeline: {
      stages,
      total: roundMoney(
        stages.reduce((sum, stage) => sum + stage.value, 0),
        base,
      ),
      count: stages.reduce((sum, stage) => sum + stage.count, 0),
    },
    ...dealHistory(history, {
      base,
      months,
      thisMonth,
      lastMonth: monthOf(now, -1),
      rateStart: new Date(
        now.getTime() - RATE_WINDOW_DAYS * DAY_MS,
      ).toISOString(),
    }),
    closingThisMonth: {
      count: closingThisMonth.deals,
      value: roundMoney(closingThisMonth.value, base),
    },
    biggestOpen,
    overdueTasks,
    recentActivity,
  };
}

export const DashboardService = {
  summary,
};
