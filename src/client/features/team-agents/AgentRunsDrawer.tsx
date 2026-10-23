import { useState } from "react";
import { sortBy } from "remeda";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Play,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { ModelNotSetUp } from "@/client/features/agent/AgentPaused";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import {
  cancelTeamAgentRun,
  retryTeamAgentRun,
  type getTeamAgentRuns,
} from "@/serverFunctions/teamAgents";
import { RUN_STATUSES } from "@/shared/team-agents";
import { AgentActivity, HistoryFilter } from "./AgentActivity";
import {
  teamAgentActivityQueryOptions,
  teamAgentKeys,
  teamAgentRunsQueryOptions,
} from "./teamAgentQueries";
import {
  RUN_STATUS_COPY,
  runFailureReason,
  TRIGGER_COPY,
} from "./teamAgentCopy";

type Run = Awaited<ReturnType<typeof getTeamAgentRuns>>[number];

const OUTCOMES = RUN_STATUSES.map((status) => ({
  value: status,
  label: RUN_STATUS_COPY[status].label,
}));

/**
 * Every run and every change, newest first (the CRM's history drawer): each
 * run's outcome, trigger, duration, external actions, tokens and cost, its
 * steps and the actions it took, with Stop for a run still going and Retry
 * for one that ended; and the agent's activity log.
 */
export function AgentRunsDrawer({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>History</SheetTitle>
        </SheetHeader>
        {open ? <HistoryTabs agentId={agentId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

const count = (rows: unknown[] | undefined) =>
  rows ? (
    <span className="font-mono text-muted-foreground">{rows.length}</span>
  ) : null;

function HistoryTabs({ agentId }: { agentId: string }) {
  const runs = useQuery(teamAgentRunsQueryOptions(agentId));
  const activity = useQuery(teamAgentActivityQueryOptions(agentId));
  return (
    <Tabs defaultValue="runs" className="min-h-0 flex-1 gap-0">
      <TabsList
        variant="line"
        className="h-10 w-full shrink-0 justify-start gap-4 rounded-none border-b border-border px-5"
      >
        <TabsTrigger value="runs" className="flex-none">
          Runs {count(runs.data)}
        </TabsTrigger>
        <TabsTrigger value="activity" className="flex-none">
          Activity {count(activity.data)}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="runs" className="min-h-0 overflow-y-auto px-5 py-4">
        <Runs agentId={agentId} />
      </TabsContent>
      <TabsContent
        value="activity"
        className="min-h-0 overflow-y-auto px-5 py-4"
      >
        <AgentActivity agentId={agentId} />
      </TabsContent>
    </Tabs>
  );
}

function Runs({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const runs = useQuery(teamAgentRunsQueryOptions(agentId));
  const [outcome, setOutcome] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: teamAgentKeys.agent(agentId) });
  const retry = useMutation({
    mutationFn: (runId: string) =>
      retryTeamAgentRun({
        data: { agentId, runId, clientRequestId: crypto.randomUUID() },
      }),
    onSuccess: async () => {
      toast.success("Run queued again.");
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (runId: string) =>
      cancelTeamAgentRun({ data: { agentId, runId } }),
    onSuccess: async (result) => {
      setStopping(null);
      toast.success(
        result.cancelled ? "Run stopped." : "That run had already finished.",
      );
      await refresh();
    },
  });

  return (
    <QueryState query={runs} errorFallback="The runs could not be loaded.">
      {(rows) => {
        const visible = rows.filter(
          (run) => !outcome || run.status === outcome,
        );
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <HistoryFilter
                name="Outcome"
                icon={CircleDot}
                all="All outcomes"
                options={OUTCOMES}
                value={outcome}
                onChange={setOutcome}
              />
            </div>
            {visible.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                number={rows.length - rows.indexOf(run)}
                expanded={expanded === run.id}
                onToggle={() =>
                  setExpanded((current) => (current === run.id ? null : run.id))
                }
                onStop={() => setStopping(run.id)}
                retrying={retry.isPending && retry.variables === run.id}
                onRetry={() => retry.mutate(run.id)}
              />
            ))}
            {visible.length === 0 ? (
              <EmptyState
                kind={outcome ? "filtered" : "no-data"}
                icon={Play}
                media="icon"
                variant="plain"
                title="No runs"
              />
            ) : null}
            {stopping ? (
              <ConfirmDialog
                title="Stop this run?"
                confirmLabel="Stop run"
                destructive
                pending={cancel.isPending}
                onConfirm={() => cancel.mutate(stopping)}
                onClose={() => setStopping(null)}
              >
                Anything it has already done stays done.
              </ConfirmDialog>
            ) : null}
          </div>
        );
      }}
    </QueryState>
  );
}

/** How long a run took: "12.3s", "In progress", or "—" before it starts. */
function duration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return "—";
  if (!finishedAt) return "In progress";
  const milliseconds = Date.parse(finishedAt) - Date.parse(startedAt);
  return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

function RunCard({
  run,
  number,
  expanded,
  onToggle,
  onStop,
  retrying,
  onRetry,
}: {
  run: Run;
  number: number;
  expanded: boolean;
  onToggle: () => void;
  onStop: () => void;
  retrying: boolean;
  onRetry: () => void;
}) {
  const ended = run.status === "FAILED" || run.status === "CANCELLED";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3 text-left outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] sm:flex-row sm:items-center sm:gap-5"
          onClick={onToggle}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                Run #{String(number).padStart(3, "0")}
              </span>
              <Badge variant={RUN_STATUS_COPY[run.status].tone}>
                {RUN_STATUS_COPY[run.status].label}
              </Badge>
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
              {TRIGGER_COPY[run.triggerType]} ·{" "}
              <LocalDateTime date={run.createdAt} /> · Version{" "}
              {run.versionNumber}
            </span>
            {run.summary && run.status === "SUCCEEDED" ? (
              <span className="mt-1 block text-sm">{run.summary}</span>
            ) : null}
            {ended ? (
              <span className="mt-1.5 flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                <span className="[overflow-wrap:anywhere]">
                  {run.errorCode === "MODEL_UNAVAILABLE" ? (
                    <ModelNotSetUp />
                  ) : (
                    runFailureReason(run.errorCode, run.errorMessage)
                  )}
                </span>
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-4 font-mono text-xs text-muted-foreground">
            <span>{duration(run.startedAt, run.finishedAt)}</span>
            <span>
              {run.actions.length} external{" "}
              {run.actions.length === 1 ? "action" : "actions"}
            </span>
            {expanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </span>
        </button>
        {run.canCancel ? (
          <span className="flex shrink-0 items-center pr-4">
            <Button variant="outline" size="sm" onClick={onStop}>
              Stop
            </Button>
          </span>
        ) : ended ? (
          <span className="flex shrink-0 items-center pr-4">
            <Button
              variant="outline"
              size="sm"
              pending={retrying}
              onClick={onRetry}
            >
              <RotateCw data-icon="inline-start" />
              Retry
            </Button>
          </span>
        ) : null}
      </div>
      {expanded ? <RunDetail run={run} /> : null}
    </div>
  );
}

const humanize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());

const eventLabel = (event: Run["events"][number]): string => {
  const data = event.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    if (typeof data.summary === "string" && data.summary.trim()) {
      return data.summary;
    }
    if (typeof data.toolName === "string") return data.toolName;
  }
  return humanize(event.type);
};

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function RunDetail({ run }: { run: Run }) {
  const timeline = sortBy(
    [
      ...run.events.map((event) => ({
        key: `event:${event.id}`,
        at: event.emittedAt,
        text: eventLabel(event),
        detail: null as string | null,
        reference: "event",
      })),
      ...run.actions.map((action) => ({
        key: `action:${action.id}`,
        at: action.completedAt ?? action.startedAt ?? action.plannedAt,
        text: action.summary,
        detail: [
          action.provider,
          humanize(action.status),
          action.targetLabel,
          action.errorMessage,
        ]
          .filter(Boolean)
          .join(" · "),
        reference: action.externalId ?? action.id.slice(0, 12),
      })),
    ],
    (entry) => entry.at,
  );
  return (
    <div className="border-t border-border">
      <dl className="grid grid-cols-2 gap-3 border-b border-border bg-foreground/[0.02] px-4 py-3 text-xs sm:grid-cols-4">
        <Meta
          label="Initiated by"
          value={run.initiatedBy ?? "Schedule or event"}
        />
        <Meta label="Model" value={run.modelId ?? "Gateway default"} />
        <Meta
          label="Tokens"
          value={`${run.inputTokens.toLocaleString()} in · ${run.outputTokens.toLocaleString()} out`}
        />
        <Meta label="Cost" value={`$${run.costUsd.toFixed(4)}`} />
      </dl>
      <ol className="divide-y divide-border">
        {timeline.map((entry) => (
          <li
            key={entry.key}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2 sm:flex sm:gap-4"
          >
            <span className="font-mono text-xs text-muted-foreground sm:w-20 sm:shrink-0 sm:pt-0.5">
              {TIME.format(new Date(entry.at))}
            </span>
            <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
              {entry.text}
              {entry.detail ? (
                <span className="block text-xs text-muted-foreground">
                  {entry.detail}
                </span>
              ) : null}
            </span>
            <span className="col-start-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere] sm:col-auto sm:shrink-0 sm:pt-0.5">
              {entry.reference}
            </span>
          </li>
        ))}
      </ol>
      {run.totalEvents > run.events.length ? (
        <p className="border-t border-border px-4 py-2 text-xs text-warning">
          Showing the first {run.events.length} of {run.totalEvents} steps.
        </p>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
