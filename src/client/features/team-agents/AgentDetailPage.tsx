import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ChevronLeft,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { RowActionsMenu } from "@/client/components/RowActionsMenu";
import { SkeletonPage } from "@/client/components/SkeletonPresets";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import {
  changeTeamAgentStatus,
  deleteTeamAgent,
  deployTeamAgent,
  runTeamAgent,
  type getTeamAgent,
} from "@/serverFunctions/teamAgents";
import { AgentCapabilities } from "./AgentCapabilities";
import { AgentRunsDrawer } from "./AgentRunsDrawer";
import { FileTabs, ManifestReview } from "./ManifestReview";
import {
  teamAgentFilesQueryOptions,
  teamAgentKeys,
  teamAgentQueryOptions,
} from "./teamAgentQueries";
import { STATUS_COPY, TRIGGER_COPY } from "./teamAgentCopy";

type Agent = Awaited<ReturnType<typeof getTeamAgent>>;

/**
 * A team agent (the CRM's team agent detail): who made it and what triggers
 * it, the version waiting for review with its exact files, and the deployed
 * version's permissions, which its creator or an admin can narrow. Runs and
 * every change are in the history drawer.
 */
export function AgentDetailPage({ agentId }: { agentId: string }) {
  const query = useQuery(teamAgentQueryOptions(agentId));
  if (!query.data) {
    return query.isError ? (
      <div className="p-6">
        <QueryError
          error={query.error}
          fallback="This agent could not be loaded."
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
          variant="page"
        />
      </div>
    ) : (
      <SkeletonPage />
    );
  }
  return <LoadedAgent agent={query.data} />;
}

function useAgentMutation<Input>(
  agentId: string,
  run: (input: Input) => Promise<unknown>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      toast.success(success);
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.list() });
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
    },
  });
}

function LoadedAgent({ agent }: { agent: Agent }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [runsOpen, setRunsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const review = agent.reviewVersion;
  const current = agent.currentVersion;

  const deploy = useAgentMutation(
    agent.id,
    (versionId: string) =>
      deployTeamAgent({
        data: {
          agentId: agent.id,
          versionId,
          clientRequestId: crypto.randomUUID(),
        },
      }),
    "Agent deployed to the team.",
  );
  const runNow = useAgentMutation(
    agent.id,
    () =>
      runTeamAgent({
        data: { agentId: agent.id, clientRequestId: crypto.randomUUID() },
      }),
    "Agent run queued.",
  );
  const transition = useAgentMutation(
    agent.id,
    (action: "pause" | "resume" | "archive" | "restore") =>
      changeTeamAgentStatus({ data: { agentId: agent.id, action } }),
    "Saved.",
  );
  const remove = useMutation({
    mutationFn: () => deleteTeamAgent({ data: { agentId: agent.id } }),
    onSuccess: async () => {
      toast.success(`${agent.name} was deleted.`);
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.list() });
      await navigate({ to: "/agents" });
    },
  });

  const enabled = agent.triggers.filter((trigger) => trigger.enabled);
  const canRunByHand =
    agent.status === "LIVE" &&
    (enabled.length === 0 ||
      enabled.some((trigger) => trigger.type !== "EVENT"));
  const isDraft = agent.status === "DRAFT";

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader
          backLink={
            <Link
              to="/agents"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
              Agents
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-2">
              {agent.name}
              <Badge variant={STATUS_COPY[agent.status].tone}>
                {STATUS_COPY[agent.status].label}
              </Badge>
            </span>
          }
          description={
            <>
              <span className="block">
                {agent.description ?? "A durable team automation."}
              </span>
              <span className="mt-1 block text-xs">
                Created by {agent.createdBy} · Version{" "}
                {current?.number ?? review?.number ?? "—"}
              </span>
            </>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => setRunsOpen(true)}>
                Runs{" "}
                <span className="font-mono text-muted-foreground">
                  {agent.runCount}
                </span>
              </Button>
              {agent.conversationId ? (
                <Button
nativeButton={false}
                  variant="outline"
                  render={
                    <Link
                      to="/agents/chat/$conversationId"
                      params={{ conversationId: agent.conversationId }}
                    />
                  }
                >
                  Open in chat
                </Button>
              ) : null}
              {canRunByHand ? (
                <Button
                  variant="outline"
                  pending={runNow.isPending}
                  onClick={() =>
                    runNow.mutate(undefined, {
                      onSuccess: () => setRunsOpen(true),
                    })
                  }
                >
                  <Play data-icon="inline-start" />
                  Run now
                </Button>
              ) : null}
              {agent.canManage && agent.status === "LIVE" ? (
                <Button
                  variant="outline"
                  pending={transition.isPending}
                  onClick={() => transition.mutate("pause")}
                >
                  <Pause data-icon="inline-start" />
                  Pause
                </Button>
              ) : null}
              {agent.canManage && agent.status === "PAUSED" ? (
                <Button
                  variant="outline"
                  pending={transition.isPending}
                  onClick={() => transition.mutate("resume")}
                >
                  <Play data-icon="inline-start" />
                  Resume
                </Button>
              ) : null}
              {agent.canManage ? (
                <RowActionsMenu label="More agent actions">
                  {agent.status === "LIVE" || agent.status === "PAUSED" ? (
                    <DropdownMenuItem
                      onClick={() => transition.mutate("archive")}
                    >
                      <Archive />
                      Archive
                    </DropdownMenuItem>
                  ) : null}
                  {agent.status === "ARCHIVED" ? (
                    <DropdownMenuItem
                      onClick={() => transition.mutate("restore")}
                    >
                      <RotateCcw />
                      Restore
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 />
                    Delete agent
                  </DropdownMenuItem>
                </RowActionsMenu>
              ) : null}
            </>
          }
        />

        {agent.status === "ARCHIVED" ? (
          <Alert>
            <AlertTitle>Archived</AlertTitle>
            <AlertDescription>
              Its triggers don't run. Restore it to pause it, then resume it to
              run again.
            </AlertDescription>
          </Alert>
        ) : null}

        {review ? (
          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <SectionHeader
              title={`Version ${review.number} is waiting for review`}
              hint={
                isDraft
                  ? "A private draft. Deploying makes it the team's: its triggers start and it can act with exactly these permissions."
                  : "Saved from the builder chat. Deploying replaces the version the team runs now."
              }
              action={
                agent.canManage ? (
                  <Button
                    pending={deploy.isPending}
                    onClick={() => deploy.mutate(review.id)}
                  >
                    Deploy agent
                  </Button>
                ) : null
              }
            />
            {review.readable ? (
              <ManifestReview manifest={review.manifest} />
            ) : (
              <Alert variant="destructive">
                <AlertTitle>This version's manifest can't be read</AlertTitle>
                <AlertDescription>{review.problem}</AlertDescription>
              </Alert>
            )}
            <VersionFiles agentId={agent.id} versionId={review.id} />
          </section>
        ) : null}

        {agent.triggers.length > 0 ? (
          <section className="space-y-3">
            <SectionHeader title="When it runs" />
            <div className="divide-y divide-border rounded-lg border border-border">
              {agent.triggers.map((trigger) => (
                <div
                  key={trigger.id}
                  className="flex items-center gap-3 px-4 py-3 text-sm"
                >
                  <Badge variant="outline">{TRIGGER_COPY[trigger.type]}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{trigger.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {trigger.summary}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {!trigger.enabled ? (
                      "Off until deployed"
                    ) : trigger.nextRunAt ? (
                      <>
                        Next <LocalDateTime date={trigger.nextRunAt} />
                      </>
                    ) : trigger.lastRunAt ? (
                      <>
                        Last <LocalDateTime date={trigger.lastRunAt} />
                      </>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {current ? (
          current.readable ? (
            <>
              <AgentCapabilities
                key={current.id}
                agentId={agent.id}
                versionId={current.id}
                manifest={current.manifest}
                canManage={agent.canManage}
              />
              <section className="space-y-3">
                <SectionHeader
                  title="Files"
                  hint="The deployed version, exactly as approved."
                />
                <VersionFiles agentId={agent.id} versionId={current.id} />
              </section>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>
                The deployed version's manifest can't be read
              </AlertTitle>
              <AlertDescription>{current.problem}</AlertDescription>
            </Alert>
          )
        ) : !review ? (
          <p className="text-sm text-muted-foreground">
            This agent has no saved version yet.
          </p>
        ) : null}
      </div>

      <AgentRunsDrawer
        agentId={agent.id}
        open={runsOpen}
        onOpenChange={setRunsOpen}
      />

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${agent.name}?`}
          confirmLabel="Delete agent"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        >
          This removes it from the agents list, turns its triggers off and
          cancels its queued runs. Its run and action history stays in the audit
          log. A run already in progress may finish.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function VersionFiles({
  agentId,
  versionId,
}: {
  agentId: string;
  versionId: string;
}) {
  const files = useQuery(teamAgentFilesQueryOptions(agentId, versionId));
  return (
    <QueryState query={files} errorFallback="The files could not be loaded.">
      {(data) =>
        data.files.length > 0 ? (
          <FileTabs files={data.files} />
        ) : (
          <p className="text-sm text-muted-foreground">No files.</p>
        )
      }
    </QueryState>
  );
}
