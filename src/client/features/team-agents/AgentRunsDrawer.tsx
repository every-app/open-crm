import { useState } from "react";
import { sortBy } from "remeda";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import {
  cancelTeamAgentRun,
  retryTeamAgentRun,
  type getTeamAgentRuns,
} from "@/serverFunctions/teamAgents";
import {
  teamAgentActivityQueryOptions,
  teamAgentKeys,
  teamAgentRunsQueryOptions,
} from "./teamAgentQueries";
import { RUN_STATUS_COPY, TRIGGER_COPY } from "./teamAgentCopy";

type Run = Awaited<ReturnType<typeof getTeamAgentRuns>>[number];

/**
 * Every run and every change, newest first (the CRM's runs drawer): each
 * run's status, trigger, tokens and cost, its steps and the actions it took,
 * with Stop for a run still going and Retry for one that ended.
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
        className="flex flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            Every run and every change, newest first.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <Tabs defaultValue="runs" className="min-h-0 flex-1 gap-0">
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="runs">Runs</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="runs" className="min-h-0 overflow-y-auto p-4">
              <Runs agentId={agentId} />
            </TabsContent>
            <TabsContent
              value="activity"
              className="min-h-0 overflow-y-auto p-4"
            >
              <Activity agentId={agentId} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Runs({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const runs = useQuery(teamAgentRunsQueryOptions(agentId));
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
      {(rows) =>
        rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No runs yet.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((run, index) => (
              <div
                key={run.id}
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="flex items-start gap-3 p-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                      setExpanded((current) =>
                        current === run.id ? null : run.id,
                      )
                    }
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        Run #{String(rows.length - index).padStart(3, "0")}
                      </span>
                      <Badge variant={RUN_STATUS_COPY[run.status].tone}>
                        {RUN_STATUS_COPY[run.status].label}
                      </Badge>
                      {expanded === run.id ? (
                        <ChevronUp className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      {TRIGGER_COPY[run.triggerType]} ·{" "}
                      <LocalDateTime date={run.createdAt} /> · Version{" "}
                      {run.versionNumber} · {run.actions.length}{" "}
                      {run.actions.length === 1 ? "action" : "actions"}
                    </span>
                    {run.summary && run.status === "SUCCEEDED" ? (
                      <span className="mt-1 block text-sm">{run.summary}</span>
                    ) : null}
                    {run.errorMessage ? (
                      <span className="mt-1.5 flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" />
                        <span className="[overflow-wrap:anywhere]">
                          {run.errorMessage}
                        </span>
                      </span>
                    ) : null}
                  </button>
                  {run.canCancel ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStopping(run.id)}
                    >
                      Stop
                    </Button>
                  ) : run.status === "FAILED" || run.status === "CANCELLED" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      pending={retry.isPending && retry.variables === run.id}
                      onClick={() => retry.mutate(run.id)}
                    >
                      <RotateCw data-icon="inline-start" />
                      Retry
                    </Button>
                  ) : null}
                </div>
                {expanded === run.id ? <RunDetail run={run} /> : null}
              </div>
            ))}
            {stopping ? (
              <ConfirmDialog
                title="Stop this run?"
                confirmLabel="Stop run"
                destructive
                pending={cancel.isPending}
                onConfirm={() => cancel.mutate(stopping)}
                onClose={() => setStopping(null)}
              >
                The agent stops where it is and the run is recorded as
                cancelled. Anything it already did (a note, a task, a Slack
                message) stays done.
              </ConfirmDialog>
            ) : null}
          </div>
        )
      }
    </QueryState>
  );
}

const eventSummary = (data: unknown): string | null =>
  typeof data === "object" &&
  data !== null &&
  "summary" in data &&
  typeof data.summary === "string"
    ? data.summary
    : typeof data === "object" &&
        data !== null &&
        "toolName" in data &&
        typeof data.toolName === "string"
      ? data.toolName
      : null;

function RunDetail({ run }: { run: Run }) {
  const timeline = sortBy(
    [
      ...run.events.map((event) => ({
        key: `event:${event.id}`,
        at: event.emittedAt,
        text: `${event.type.replace(/\./g, " ")}${eventSummary(event.data) ? `: ${eventSummary(event.data)}` : ""}`,
        detail: null as string | null,
      })),
      ...run.actions.map((action) => ({
        key: `action:${action.id}`,
        at: action.completedAt ?? action.startedAt ?? action.plannedAt,
        text: action.summary,
        detail: `${action.provider} · ${action.status.toLowerCase()}${action.targetLabel ? ` · ${action.targetLabel}` : ""}${action.errorMessage ? ` · ${action.errorMessage}` : ""}`,
      })),
    ],
    (entry) => entry.at,
  );
  return (
    <div className="border-t border-border bg-muted/20">
      <dl className="grid grid-cols-2 gap-3 border-b border-border p-3 text-xs sm:grid-cols-4">
        <Meta
          label="Initiated by"
          value={run.initiatedBy ?? "Schedule or event"}
        />
        <Meta label="Model" value={run.modelId ?? "—"} />
        <Meta
          label="Tokens"
          value={`${run.inputTokens.toLocaleString()} in · ${run.outputTokens.toLocaleString()} out`}
        />
        <Meta label="Cost" value={`$${run.costUsd.toFixed(4)}`} />
      </dl>
      <ol className="divide-y divide-border">
        {timeline.map((entry) => (
          <li key={entry.key} className="flex gap-3 px-3 py-2 text-sm">
            <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
              {new Date(entry.at).toLocaleTimeString()}
            </span>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {entry.text}
              {entry.detail ? (
                <span className="block text-xs text-muted-foreground">
                  {entry.detail}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {run.totalEvents > run.events.length ? (
        <p className="px-3 py-2 text-xs text-warning">
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
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Activity({ agentId }: { agentId: string }) {
  const activity = useQuery(teamAgentActivityQueryOptions(agentId));
  return (
    <QueryState
      query={activity}
      errorFallback="The activity could not be loaded."
    >
      {(rows) => (
        <ol className="divide-y divide-border rounded-lg border border-border">
          {rows.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:gap-4"
            >
              <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">
                <LocalDateTime date={event.emittedAt} />
              </span>
              <span className={cn("min-w-0 flex-1 text-sm")}>
                {event.summary}
                {event.versionNumber ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · version {event.versionNumber}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {event.actorName ??
                  (event.actorType === "AGENT" ? "The agent" : "The CRM")}
              </span>
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing yet.
            </li>
          ) : null}
        </ol>
      )}
    </QueryState>
  );
}
