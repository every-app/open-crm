import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/client/components/ui/card";
import {
  StageBreakdown,
  TrendChart,
} from "@/client/features/dashboard/SalesCharts";
import {
  formatCount,
  formatMoneyCompact,
  formatPercent,
  type DashboardSummary,
} from "@/client/features/dashboard/dashboardFormat";

// The top of Home: the headline figures, then the trend and the open
// pipeline by stage (SalesCharts).

type Delta = { text: string; up: boolean | null };

/** "+12%" against `previous`, or nothing when there was nothing before. */
function changeFrom(current: number, previous: number): Delta | undefined {
  if (previous === 0) return undefined;
  const change = Math.round(((current - previous) / previous) * 100);
  return {
    text: `${change > 0 ? "+" : ""}${change}%`,
    up: change === 0 ? null : change > 0,
  };
}

function StatTile({
  label,
  value,
  delta,
  description,
}: {
  label: string;
  value: string;
  delta?: Delta;
  description: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-card p-4 md:p-5">
      <span
        className="truncate text-sm font-medium text-muted-foreground"
        title={label}
      >
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {delta ? (
          <span className="text-xs">
            <span
              className={cn(
                "font-medium tabular-nums",
                delta.up === null
                  ? "text-muted-foreground"
                  : delta.up
                    ? "text-success"
                    : "text-destructive",
              )}
            >
              {delta.up === null ? null : (
                <span aria-hidden>{delta.up ? "↑ " : "↓ "}</span>
              )}
              {delta.text}
            </span>{" "}
            <span className="text-muted-foreground">vs. last month</span>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-pretty text-muted-foreground">{description}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
    </Card>
  );
}

export function SalesSummary({ summary }: { summary: DashboardSummary }) {
  const {
    pipeline,
    wonThisMonth,
    wonLastMonth,
    performance,
    closingThisMonth,
    reportingCurrency: currency,
    unconverted,
  } = summary;
  const money = (value: number) => formatMoneyCompact(value, currency);
  const hasTrend = summary.trend.some(
    (point) => point.won > 0 || point.created > 0,
  );
  // Only the stages holding value, as the original CRM lists them.
  const openStages = pipeline.stages.filter((stage) => stage.value > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm lg:grid-cols-4">
        <StatTile
          label="Closed won this month"
          value={money(wonThisMonth.value)}
          delta={changeFrom(wonThisMonth.value, wonLastMonth.value)}
          description={`${formatCount(wonThisMonth.count, "deal")} · ${money(wonLastMonth.value)} last month`}
        />
        <StatTile
          label="Open pipeline"
          value={money(pipeline.total)}
          description={`${formatCount(pipeline.count, "deal")} in progress · ${money(closingThisMonth.value)} due this month`}
        />
        <StatTile
          label={`Win rate (${performance.windowDays}d)`}
          value={
            performance.winRate === null
              ? "—"
              : formatPercent(performance.winRate)
          }
          description={
            performance.wins + performance.losses === 0
              ? "Nothing has closed yet"
              : `${performance.wins} won · ${performance.losses} lost`
          }
        />
        <StatTile
          label={`Average deal (${performance.windowDays}d)`}
          value={
            performance.averageDeal === null
              ? "—"
              : money(performance.averageDeal)
          }
          description={
            performance.averageCycleDays === null
              ? "No wins to measure"
              : `${performance.averageCycleDays}-day average cycle`
          }
        />
      </div>

      {unconverted.count > 0 ? (
        <p className="text-xs text-muted-foreground">
          Every figure here is in {currency}.{" "}
          {formatCount(unconverted.count, "deal")} in{" "}
          {unconverted.currencies.join(", ")}{" "}
          {unconverted.count === 1 ? "is" : "are"} left out: there is no rate to
          convert {unconverted.count === 1 ? "it" : "them"} with.{" "}
          <Link
            to="/settings/currencies"
            className="underline underline-offset-3 hover:text-foreground"
          >
            Set one
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Closed won vs. new pipeline"
          description="Last six months, by the month a deal closed or was created"
        >
          {hasTrend ? (
            <TrendChart trend={summary.trend} currency={currency} />
          ) : (
            <EmptyPanel label="No deals closed or created yet" />
          )}
        </Panel>
        <Panel
          title="Open pipeline by stage"
          description="Where the value sits right now"
        >
          {openStages.length > 0 ? (
            <StageBreakdown stages={openStages} currency={currency} />
          ) : (
            <EmptyPanel label="Nothing open" />
          )}
        </Panel>
      </div>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
