import { Link } from "@tanstack/react-router";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  AboutRecord,
  TaskCheckbox,
  TaskDue,
} from "@/client/features/activities/TaskParts";
import {
  ACTIVITY_PRESENTATION,
  activityAuthor,
  activityHeadline,
} from "@/client/features/activities/activityFormat";
import {
  formatCount,
  formatMoneyCompact,
  type DashboardSummary,
} from "@/client/features/dashboard/dashboardFormat";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import { EmptyValue, EntityLogo } from "@/client/features/records/cells";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";

// The lists under Home's figures: the deals worth chasing, the viewer's
// overdue tasks, and what happened last.

function Empty({ children }: { children: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/** How a deal's value compares with the largest: one hue, a lighter track. */
function ValueMeter({ share }: { share: number }) {
  return (
    <span className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-[2px] bg-chart-1/15 sm:block">
      <span
        className="block h-full rounded-[2px] bg-chart-1"
        style={{
          width: `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%`,
        }}
      />
    </span>
  );
}

export function DealsInProgress({ summary }: { summary: DashboardSummary }) {
  const deals = summary.biggestOpen;
  const largest = deals[0]?.baseAmount ?? 0;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Deals in progress</CardTitle>
        <CardDescription>
          The largest open deals, and how long each has sat in its stage
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/deals" />}
          >
            Open deals
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {deals.length === 0 ? (
          <Empty>Nothing open. Time to fill the pipeline.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {deals.map((deal) => (
              <li
                key={deal.id}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <EntityLogo
                  src={deal.company.iconUrl}
                  darkSrc={deal.company.iconDarkUrl}
                  tone={deal.company.iconTone}
                  name={deal.company.name}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <RecordLink
                    record={{ kind: "deal", id: deal.id }}
                    className="font-medium"
                  >
                    {deal.name}
                  </RecordLink>
                  <span className="truncate text-xs text-muted-foreground">
                    {deal.company.name} · {DEAL_STAGE_LABELS[deal.stage]}{" "}
                    <RelativeTime date={deal.stageChangedAt} />
                  </span>
                </span>
                <ValueMeter
                  share={largest > 0 ? (deal.baseAmount ?? 0) / largest : 0}
                />
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {deal.amount === null ? (
                    <EmptyValue />
                  ) : (
                    formatMoneyCompact(deal.amount, deal.currency)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverdueTasks({ summary }: { summary: DashboardSummary }) {
  const tasks = summary.overdueTasks;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Overdue tasks</CardTitle>
        <CardDescription>
          {tasks.length === 0
            ? "Every task you set is either done or still to come"
            : `${formatCount(tasks.length, "task")} past due`}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/tasks" />}
          >
            My tasks
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <Empty>Nothing overdue. Good.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-3 py-2.5 text-sm"
              >
                <span className="mt-0.5 flex">
                  <TaskCheckbox task={task} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{task.subject}</span>
                  <span className="flex min-w-0 text-xs text-muted-foreground">
                    <AboutRecord entry={task} />
                  </span>
                </span>
                {task.dueAt ? <TaskDue dueAt={task.dueAt} /> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentActivity({ summary }: { summary: DashboardSummary }) {
  const mine = summary.scope === "me";
  const entries = summary.recentActivity;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          {mine ? "Your recent activity" : "Recent activity"}
        </CardTitle>
        <CardDescription>
          {mine
            ? "Every note, task and stage change you have logged"
            : "Every note, task and stage change across the workspace"}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/companies" />}
          >
            All companies
          </Button>
        </CardAction>
      </CardHeader>
      {entries.length === 0 ? (
        <CardContent>
          <Empty>Nothing has happened yet.</Empty>
        </CardContent>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Activity</TableHead>
              <TableHead className="hidden w-44 md:table-cell">
                Company
              </TableHead>
              <TableHead className="hidden w-48 lg:table-cell">Deal</TableHead>
              <TableHead className="hidden w-32 md:table-cell">Who</TableHead>
              <TableHead className="w-28 text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const { label, icon: Icon } = ACTIVITY_PRESENTATION[entry.type];
              return (
                <TableRow key={entry.id}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label={label}
                      />
                      <span className="truncate">
                        {activityHeadline(entry) ?? entry.body ?? label}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {entry.company ? (
                      <RecordLink
                        record={{ kind: "company", id: entry.company.id }}
                        className="block"
                      >
                        {entry.company.name}
                      </RecordLink>
                    ) : (
                      <EmptyValue />
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {entry.deal ? (
                      <RecordLink
                        record={{ kind: "deal", id: entry.deal.id }}
                        className="block"
                      >
                        {entry.deal.name}
                      </RecordLink>
                    ) : (
                      <EmptyValue />
                    )}
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground md:table-cell">
                    {activityAuthor(entry)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    <RelativeTime date={entry.createdAt} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
