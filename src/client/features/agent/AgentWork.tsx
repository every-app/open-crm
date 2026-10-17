import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { Skeleton } from "@/client/components/ui/skeleton";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import type { TaskHold } from "@/shared/agent-availability";
import { MAX_ATTEMPTS } from "@/shared/agent-tasks";
import type { RecordRef } from "@/shared/records";
import { AgentStepLine } from "./AgentStepLine";
import { agentRuns, type Run } from "./agentLog";
import { agentActivityQueryOptions } from "./agentQueries";
import {
  dueLabel,
  elapsedLabel,
  enrichmentStep,
  useSeconds,
} from "./enrichmentCopy";

const STEPS_PAGE = 50;
// The most listAgentActivity returns at once (agentEventsQuerySchema).
const STEPS_PAGE_MAX = 200;

type OpenTask = {
  id: string;
  kind: string;
  reason: string;
  dueAt: string;
  leasedUntil: string | null;
  attempts: number;
  startedAt: string | null;
  hold: TaskHold;
};

const HELD = {
  setup: {
    label: "Waiting for setup",
    title:
      "The agent's model isn't set up on your Every App gateway yet. This runs once it is.",
  },
  schedule: {
    label: "Held",
    title: "Background research is off on this deployment. Enrich now runs it.",
  },
} as const;

/**
 * What the agent is doing on a record and what it did: its open tasks, and
 * the steps of its research runs and the person's conversations, each step's
 * outcome and sources shown, the leads it threw away included.
 */
export function AgentWork({
  record,
  conversations,
  openConversationId,
  defaultOpen,
}: {
  record: RecordRef;
  /** The person's conversations about the record, to name their runs. */
  conversations: { id: string; title: string | null }[];
  openConversationId: string | null;
  /** Show the steps unfolded (no conversation is open to read). */
  defaultOpen: boolean;
}) {
  const [limit, setLimit] = useState(STEPS_PAGE);
  const activity = useQuery(agentActivityQueryOptions(record, limit));

  if (activity.isPending) {
    return (
      <div className="space-y-2 border-b border-border px-5 py-3" aria-busy>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }
  if (!activity.data) {
    return (
      <div className="border-b border-border px-5 py-3">
        <QueryError
          variant="inline"
          error={activity.error}
          fallback="What the agent did here could not be loaded."
          onRetry={() => void activity.refetch()}
          isRetrying={activity.isFetching}
        />
      </div>
    );
  }

  const { openTasks, events } = activity.data;
  const runs = agentRuns(events);
  if (openTasks.length === 0 && runs.length === 0) return null;
  const titles = new Map(conversations.map((row) => [row.id, row.title]));
  const runTitle = (run: Run) =>
    run.conversationId === null
      ? "Research"
      : run.conversationId === openConversationId
        ? "In this conversation"
        : `In “${titles.get(run.conversationId) ?? "an earlier conversation"}”`;
  const steps = runs.reduce((sum, run) => sum + run.entries.length, 0);
  const more = events.length >= limit && limit < STEPS_PAGE_MAX;

  return (
    <section
      aria-label="The agent's work on this record"
      className="space-y-3 border-b border-border px-5 py-3"
    >
      {openTasks.length > 0 ? (
        <ul className="space-y-1.5">
          {openTasks.map((task) => (
            <OpenTaskLine key={task.id} task={task} />
          ))}
        </ul>
      ) : null}
      {runs.length > 0 ? (
        <Collapsible defaultOpen={defaultOpen}>
          <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronRight className="size-3 transition-transform group-data-panel-open:rotate-90" />
            <span>
              {steps === 1 ? "1 step" : `${steps} steps`}
              {runs.length > 1 ? ` across ${runs.length} runs` : ""}, latest{" "}
              <RelativeTime date={runs[0]?.at ?? ""} />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4">
            <ol className="space-y-4">
              {runs.map((run) => (
                <li key={run.sessionId} className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {runTitle(run)}
                    </span>{" "}
                    · <RelativeTime date={run.at} />
                  </p>
                  <ol className="space-y-2">
                    {run.entries.map((entry) => (
                      <li key={entry.id}>
                        <AgentStepLine step={entry} detail={entry.detail} />
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
            {more ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0 text-muted-foreground hover:text-foreground"
                pending={activity.isFetching}
                onClick={() =>
                  setLimit((current) => Math.min(current * 2, STEPS_PAGE_MAX))
                }
              >
                Show earlier steps
              </Button>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}

/** One open task: what it is doing now, or when it is due. */
function OpenTaskLine({ task }: { task: OpenTask }) {
  const now = useSeconds();
  const running =
    task.leasedUntil !== null && Date.parse(task.leasedUntil) > now;
  const due = Date.parse(task.dueAt) <= now;
  const failed = !running && task.attempts >= MAX_ATTEMPTS;
  const held = !running && !failed && due && task.hold ? HELD[task.hold] : null;
  const status = running
    ? elapsedLabel("running", task.startedAt, now)
    : failed
      ? "Could not look this up"
      : held
        ? held.label
        : due
          ? "Waiting"
          : dueLabel(task.dueAt, now);
  return (
    <li className="space-y-0.5">
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            running
              ? "animate-pulse bg-info"
              : failed
                ? "bg-destructive"
                : held
                  ? "bg-warning"
                  : "bg-muted-foreground/60",
          )}
        />
        <span className="min-w-0 flex-1 truncate">
          {enrichmentStep(task.kind)}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs",
            failed ? "text-destructive" : "text-muted-foreground",
            running && "font-mono",
          )}
          title={held?.title}
        >
          {status}
        </span>
      </div>
      {!due ? (
        <p className="ml-3.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {task.reason}
        </p>
      ) : null}
    </li>
  );
}
