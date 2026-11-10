import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Plus } from "lucide-react";
import { cn } from "cn";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { CreateListDialog } from "@/client/features/lists/ListDialog";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { listsQueryOptions } from "@/client/features/lists/listQueries";
import type { ListSummary } from "@/server/features/lists/services/ListService";

// Home's Lists: each list with how many are at each of its stages, and who
// is Due, each opening the list in the contacts or companies page. With no
// list yet, the way to make the first.

/** Open stages darken along the way; done is green, dropped fades out. */
const OPEN_SHADES = [
  "bg-chart-1/35",
  "bg-chart-1/55",
  "bg-chart-1/75",
  "bg-chart-1",
];

function stageShade(stage: ListSummary["stages"][number], openIndex: number) {
  if (stage.kind === "DONE") return "bg-emerald-500";
  if (stage.kind === "DROPPED") return "bg-muted-foreground/30";
  return OPEN_SHADES[Math.min(openIndex, OPEN_SHADES.length - 1)];
}

export function ListsCard() {
  const lists = useQuery(listsQueryOptions());
  const [creating, setCreating] = useState(false);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Lists</CardTitle>
      </CardHeader>
      <CardContent>
        {lists.isError ? (
          <QueryError
            error={lists.error}
            fallback="The lists could not be loaded."
            onRetry={() => void lists.refetch()}
            isRetrying={lists.isFetching}
          />
        ) : !lists.data ? (
          <Skeleton className="h-24" />
        ) : lists.data.length === 0 ? (
          <EmptyState
            variant="plain"
            size="sm"
            icon={ListChecks}
            title="No lists yet"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                New list
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {lists.data.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        )}
      </CardContent>
      {creating ? (
        <CreateListDialog onClose={() => setCreating(false)} />
      ) : null}
    </Card>
  );
}

function ListRow({ list }: { list: ListSummary }) {
  const to = list.entity === "CONTACT" ? "/contacts" : "/companies";
  const noun =
    list.entity === "CONTACT"
      ? list.total === 1
        ? "contact"
        : "contacts"
      : list.total === 1
        ? "company"
        : "companies";
  let openIndex = 0;
  const stages = list.stages.map((stage) => ({
    ...stage,
    shade: stageShade(stage, stage.kind === "OPEN" ? openIndex++ : 0),
  }));
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", LIST_DOT[list.color])}
        />
        <Link
          to={to}
          search={{ list: list.id }}
          className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
        >
          {list.name}
        </Link>
        <span className="text-muted-foreground tabular-nums">
          {list.total.toLocaleString()} {noun}
        </span>
        {list.due > 0 ? (
          <Link
            to={to}
            search={{ list: list.id, listDue: true }}
            className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 tabular-nums hover:bg-amber-500/25 dark:text-amber-300"
          >
            {list.due.toLocaleString()} due
          </Link>
        ) : null}
      </div>
      {stages.length > 0 && list.total > 0 ? (
        <>
          <div
            aria-hidden
            className="flex h-1.5 overflow-hidden rounded-[2px] bg-muted"
          >
            {stages.map((stage) =>
              stage.count > 0 ? (
                <span
                  key={stage.id}
                  className={cn("h-full", stage.shade)}
                  style={{ width: `${(stage.count / list.total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {stages.map((stage) => (
              <li key={stage.id}>
                <Link
                  to={to}
                  search={{ list: list.id, stage: [stage.id] }}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      stage.shade,
                    )}
                  />
                  {stage.name}
                  <span className="text-foreground tabular-nums">
                    {stage.count.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
            {list.noStage > 0 ? (
              <li>
                No stage{" "}
                <span className="text-foreground tabular-nums">
                  {list.noStage.toLocaleString()}
                </span>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </li>
  );
}
