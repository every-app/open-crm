import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Pause, Play } from "lucide-react";
import { sortBy } from "remeda";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { SkeletonPage } from "@/client/components/SkeletonPresets";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  changeTeamAgentStatus,
  deployTeamAgent,
  runTeamAgent,
  type getTeamAgent,
} from "@/serverFunctions/teamAgents";
import { AgentActionsMenu } from "./AgentActionsMenu";
import { AgentCapabilities } from "./AgentCapabilities";
import { AgentCode } from "./AgentCode";
import { AgentRunsDrawer } from "./AgentRunsDrawer";
import { useAgentMutation } from "./agentEditing";
import { ManifestReview } from "./ManifestReview";
import { teamAgentQueryOptions } from "./teamAgentQueries";
import { STATUS_COPY, TRIGGER_COPY } from "./teamAgentCopy";

type Agent = Awaited<ReturnType<typeof getTeamAgent>>;

// What drives the agent first; running it by hand last.
const TRIGGER_ORDER = ["SCHEDULE", "EVENT", "MANUAL"] as const;

/**
 * A team agent (the CRM's team agent detail): what triggers it, the version
 * waiting for review, and its permissions and code as that version has them
 * (else as deployed), which its creator or an admin can change. Archiving
 * and deleting are in its ⋯ menu; runs and every change are in the history
 * drawer.
 */
export function AgentDetailPage({ agentId }: { agentId: string }) {
  const query = useQuery(teamAgentQueryOptions(agentId));
  if (getErrorCode(query.error) === "NOT_FOUND") return <UnavailableAgent />;
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

/**
 * An agent that doesn't exist, was deleted, or is someone else's draft (the
 * CRM's "Agent unavailable"), as a chat that isn't there shows.
 */
function UnavailableAgent() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState variant="plain" icon={Bot} title="Agent unavailable" />
    </div>
  );
}

function LoadedAgent({ agent }: { agent: Agent }) {
  const [runsOpen, setRunsOpen] = useState(false);
  // Saving or discarding the page's changes starts its editor afresh.
  const [resets, setResets] = useState(0);
  const review = agent.reviewVersion;
  const current = agent.currentVersion;
  const isDraft = agent.status === "DRAFT";
  // A deployed agent's editor shows, and its changes build on, the version
  // waiting for review.
  const editing = current?.readable && review?.readable ? review : null;

  const runNow = useAgentMutation(
    agent.id,
    () =>
      runTeamAgent({
        data: { agentId: agent.id, clientRequestId: crypto.randomUUID() },
      }),
    "Run queued.",
  );
  const transition = useAgentMutation(
    agent.id,
    (action: "pause" | "resume") =>
      changeTeamAgentStatus({ data: { agentId: agent.id, action } }),
    "Saved.",
  );

  // A version saved for review lands at the top: take the reader to it.
  const reviewRef = useRef<HTMLDivElement>(null);
  const seenReview = useRef(review?.id ?? null);
  useEffect(() => {
    if (review && review.id !== seenReview.current) {
      reviewRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    seenReview.current = review?.id ?? null;
  }, [review]);

  const enabled = agent.triggers.filter((trigger) => trigger.enabled);
  const canRunByHand =
    agent.status === "LIVE" &&
    (enabled.length === 0 ||
      enabled.some((trigger) => trigger.type !== "EVENT"));

  return (
    // The page fills the column, so its save bar sits at the foot of a short
    // page too.
    <div className="flex min-h-full flex-col px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10">
        <PageHeader
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
              {agent.description ? (
                <span className="block">{agent.description}</span>
              ) : null}
              <span className="mt-1 block text-xs">
                Created by {agent.createdBy} · Version{" "}
                {current?.number ?? review?.number ?? "—"}
              </span>
            </>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => setRunsOpen(true)}>
                Runs
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
                      to="/chat/$chatId"
                      params={{ chatId: agent.conversationId }}
                    />
                  }
                >
                  {isDraft ? "Change details" : "Open in chat"}
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
              {agent.canManage ? <AgentActionsMenu agent={agent} /> : null}
            </>
          }
        />

        {review ? (
          <div ref={reviewRef} className="scroll-mt-6">
            <ReviewSection
              agent={agent}
              review={review}
              withCode={editing === null}
            />
          </div>
        ) : null}

        {current && agent.triggers.length > 0 ? (
          <SettingsSection title="When it runs">
            <SettingsCard>
              {sortBy(agent.triggers, (trigger) =>
                TRIGGER_ORDER.indexOf(trigger.type),
              ).map((trigger) => (
                <SettingsRow
                  key={trigger.id}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      {trigger.name}
                      <Badge variant="outline">
                        {TRIGGER_COPY[trigger.type]}
                      </Badge>
                    </span>
                  }
                  description={trigger.summary}
                >
                  <span className="text-sm text-muted-foreground">
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
                </SettingsRow>
              ))}
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {current?.readable ? (
          <AgentCapabilities
            key={`${(editing ?? current).id}:${resets}`}
            agentId={agent.id}
            versionId={(editing ?? current).id}
            manifest={(editing ?? current).manifest}
            live={editing ? current.manifest : null}
            canManage={agent.canManage}
            onReset={() => setResets((count) => count + 1)}
          />
        ) : current ? (
          <Alert variant="destructive">
            <AlertTitle>This version's manifest cannot be read</AlertTitle>
            <AlertDescription>{current.problem}</AlertDescription>
          </Alert>
        ) : !review ? (
          <p className="text-sm text-muted-foreground">
            No deployed version yet.
          </p>
        ) : null}
      </div>

      <AgentRunsDrawer
        agentId={agent.id}
        open={runsOpen}
        onOpenChange={setRunsOpen}
      />
    </div>
  );
}

/**
 * The version waiting for a person to deploy it, exactly as it would run:
 * with its files, unless the editor below shows them.
 */
function ReviewSection({
  agent,
  review,
  withCode,
}: {
  agent: Agent;
  review: NonNullable<Agent["reviewVersion"]>;
  withCode: boolean;
}) {
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
    "Deployed.",
  );
  return (
    <SettingsSection
      title={`Version ${review.number} waits for review`}
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
    >
      <div className="space-y-4">
        {review.readable ? (
          <SettingsCard className="p-5">
            <ManifestReview manifest={review.manifest} />
          </SettingsCard>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>This version's manifest cannot be read</AlertTitle>
            <AlertDescription>{review.problem}</AlertDescription>
          </Alert>
        )}
        {withCode ? (
          <AgentCode agentId={agent.id} versionId={review.id} />
        ) : null}
      </div>
    </SettingsSection>
  );
}
