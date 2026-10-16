import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { cn } from "cn";
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
import { formatMoney } from "@/client/features/companies/companyFormat";
import {
  STAGE_FILL,
  formatCount,
  formatMoneyCompact,
  monthLabel,
  type DashboardSummary,
} from "@/client/features/dashboard/dashboardFormat";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";

// Home's two charts: where the money moved over six months, and where the
// open pipeline sits now. Each keeps its numbers readable without hovering:
// the trend behind "Show the numbers", the stages in the list under the bar.

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

export function TrendChart({
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

export function StageBreakdown({
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
            const label = `${DEAL_STAGE_LABELS[slice.stage]}: ${formatMoney(slice.value, currency)}, ${formatCount(slice.count, "deal")}`;
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
            className="border-t border-border first:border-t-0"
          >
            {/* The stage's deals, on the deals list. */}
            <Link
              to="/deals"
              search={{ stage: [stage.stage] }}
              className="flex items-center gap-2.5 py-2 hover:underline"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-[2px]",
                  STAGE_FILL[stage.stage],
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {DEAL_STAGE_LABELS[stage.stage]}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {stage.count}
              </span>
              <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                {formatMoneyCompact(stage.value, currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
