import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/client/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  STAGE_LABELS,
  formatMoney,
} from "@/client/features/companies/companyFormat";
import {
  STAGE_FILL,
  formatCount,
  formatMoneyCompact,
  formatPercent,
  monthLabel,
  type DashboardSummary,
} from "@/client/features/dashboard/dashboardFormat";

// The top of Home: the headline figures, then where the money moved over six
// months and where the open pipeline sits now.

const TREND_SERIES = [
  { key: "won", label: "Closed won" },
  { key: "created", label: "New pipeline" },
] as const;

// The chart palette's first two slots, checked as an adjacent pair on both
// card surfaces.
const TREND_CONFIG: ChartConfig = {
  won: { label: "Closed won", color: "var(--chart-1)" },
  created: { label: "New pipeline", color: "var(--chart-2)" },
};

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
      <span className="truncate text-sm font-medium text-muted-foreground">
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
          <StageBreakdown pipeline={pipeline} currency={currency} />
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

function TrendChart({
  trend,
  currency,
}: {
  trend: DashboardSummary["trend"];
  currency: string;
}) {
  const data = trend.map((point) => ({
    ...point,
    label: monthLabel(point.month),
  }));
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {TREND_SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{
                backgroundColor: String(TREND_CONFIG[series.key]?.color),
              }}
            />
            {series.label}
          </li>
        ))}
      </ul>
      <ChartContainer
        config={TREND_CONFIG}
        className="h-[220px]"
        aria-label="Closed won and new pipeline by month"
      >
        <LineChart
          data={data}
          margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) =>
              formatMoneyCompact(value, currency)
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                valueFormatter={(value) => formatMoney(Number(value), currency)}
              />
            }
          />
          {TREND_SERIES.map((series) => (
            <Line
              key={series.key}
              dataKey={series.key}
              type="monotone"
              stroke={`var(--color-${series.key})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--card)",
                fill: `var(--color-${series.key})`,
              }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Show the numbers
          <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <table className="mt-2 w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Month</th>
                {TREND_SERIES.map((series) => (
                  <th key={series.key} className="py-1 text-right font-medium">
                    {series.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((point) => (
                <tr key={point.month} className="border-t border-border">
                  <td className="py-1">{point.label}</td>
                  <td className="py-1 text-right">
                    {formatMoney(point.won, currency)}
                  </td>
                  <td className="py-1 text-right">
                    {formatMoney(point.created, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function StageBreakdown({
  pipeline,
  currency,
}: {
  pipeline: DashboardSummary["pipeline"];
  currency: string;
}) {
  const slices = pipeline.stages.filter((stage) => stage.value > 0);
  return (
    <div className="flex flex-1 flex-col gap-4">
      {slices.length > 0 ? (
        <div className="flex h-3 gap-0.5">
          {slices.map((slice) => {
            const label = `${STAGE_LABELS[slice.stage]}: ${formatMoney(slice.value, currency)}, ${formatCount(slice.count, "deal")}`;
            return (
              <Tooltip key={slice.stage}>
                <TooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      aria-label={label}
                      className={cn(
                        "h-full min-w-1 basis-0 outline-none first:rounded-l-[4px] last:rounded-r-[4px] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
                        STAGE_FILL[slice.stage],
                      )}
                      style={{ flexGrow: slice.value }}
                    />
                  }
                />
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing open.</p>
      )}
      <ul className="flex flex-col text-xs">
        {pipeline.stages.map((stage) => (
          <li
            key={stage.stage}
            className="flex items-center gap-2.5 border-t border-border py-2 first:border-t-0"
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-[2px]",
                STAGE_FILL[stage.stage],
              )}
            />
            <span className="min-w-0 flex-1 truncate">
              {STAGE_LABELS[stage.stage]}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {stage.count}
            </span>
            <span className="w-16 shrink-0 text-right font-medium tabular-nums">
              {formatMoneyCompact(stage.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
