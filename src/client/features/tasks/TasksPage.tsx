import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { z } from "zod";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { TableCard } from "@/client/components/ui/table";
import { TabsTrigger } from "@/client/components/ui/tabs";
import {
  AboutRecord,
  TaskCheckbox,
  TaskDue,
} from "@/client/features/activities/TaskParts";
import type { ActivityEntry } from "@/client/features/activities/activityFormat";
import { myTasksQueryOptions } from "@/client/features/activities/activityQueries";
import { TASK_WINDOWS, type TaskWindow } from "@/types/schemas/activities";

/** /tasks: which open tasks to show, in the URL so a link brings it back. */
export const tasksSearchSchema = z.object({
  window: z.enum(TASK_WINDOWS).optional().catch(undefined),
});

const routeApi = getRouteApi("/_app/tasks");

const WINDOW_LABELS: Record<TaskWindow, string> = {
  all: "All open",
  overdue: "Overdue",
  upcoming: "Upcoming",
};

const EMPTY: Record<TaskWindow, { title: string; description: string }> = {
  all: {
    title: "No open tasks",
    description:
      "Tasks you add on a company's, contact's or deal's timeline show up here until you tick them off.",
  },
  overdue: {
    title: "Nothing overdue",
    description: "Every task you set is either done or still to come.",
  },
  upcoming: {
    title: "Nothing coming up",
    description: "Tasks due later show up here.",
  },
};

/** /tasks: the open tasks the viewer set themselves, soonest due first. */
export function TasksPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const view = search.window ?? "all";
  const query = useQuery(myTasksQueryOptions(view));

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title="My tasks"
          description="The tasks you set yourself, soonest due first. Add one from any company's, contact's or deal's timeline."
        />
        <TableCard>
          <DataTableTabs
            value={view}
            onValueChange={(next) => {
              const picked = TASK_WINDOWS.find((value) => value === next);
              if (!picked) return;
              void navigate({
                search: { window: picked === "all" ? undefined : picked },
                replace: true,
              });
            }}
          >
            {TASK_WINDOWS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {WINDOW_LABELS[value]}
              </TabsTrigger>
            ))}
          </DataTableTabs>
          {query.isPending ? (
            <SkeletonTableRows className="p-4" rows={5} columns={3} />
          ) : query.isError ? (
            <div className="p-4">
              <QueryError
                error={query.error}
                fallback="Your tasks could not be loaded."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            </div>
          ) : query.data.length === 0 ? (
            <div className="p-4">
              <EmptyState
                variant="plain"
                title={EMPTY[view].title}
                description={EMPTY[view].description}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {query.data.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </TableCard>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: ActivityEntry }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      <span className="mt-0.5 flex">
        <TaskCheckbox task={task} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium [overflow-wrap:anywhere]">
          {task.subject ?? "Task"}
        </p>
        {task.body ? (
          <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {task.body}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <AboutRecord entry={task} />
          {task.dueAt ? (
            <TaskDue dueAt={task.dueAt} />
          ) : (
            <span>No due date</span>
          )}
        </div>
      </div>
    </li>
  );
}
