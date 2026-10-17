import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { sortBy } from "remeda";
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
import {
  changeTeamAgentStatus,
  deployTeamAgent,
  runTeamAgent,
  type getTeamAgent,
} from "@/serverFunctions/teamAgents";
import { AgentCapabilities } from "./AgentCapabilities";
import { AgentCode } from "./AgentCode";
import { AgentDangerZone } from "./AgentDangerZone";
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
 * waiting for review with its exact files, the deployed version's
 * permissions and code, which its creator or an admin can change, and a
 * danger zone. Runs and every change are in the history drawer.
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

function LoadedAgent({ agent }: { agent: Agent }) {
  const [runsOpen, setRunsOpen] = useState(false);
  const review = agent.reviewVersion;
  const current = agent.currentVersion;
  const isDraft = agent.status === "DRAFT";

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
    <div className="px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">
      <div className="mx-auto max-w-4xl space-y-10">
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
            </>
          }
        />

        {review ? (
          <div ref={reviewRef} className="scroll-mt-6">
            <ReviewSection agent={agent} review={review} />
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
          <>
            <AgentCapabilities
              key={current.id}
              agentId={agent.id}
              manifest={current.manifest}
              canManage={agent.canManage}
            />
            <SettingsSection
              title="Code"
              description="What the agent actually runs."
            >
              <AgentCode
                agentId={agent.id}
                versionId={current.id}
                editable={agent.canManage}
              />
            </SettingsSection>
          </>
        ) : current ? (
          <Alert variant="destructive">
            <AlertTitle>This version's manifest cannot be read</AlertTitle>
            <AlertDescription>{current.problem}</AlertDescription>
          </Alert>
        ) : !review ? (
          <p className="text-sm text-muted-foreground">
            This agent has no deployed version yet.
          </p>
        ) : null}

        {agent.canManage ? <AgentDangerZone agent={agent} /> : null}
      </div>

      <AgentRunsDrawer
        agentId={agent.id}
        open={runsOpen}
        onOpenChange={setRunsOpen}
      />
    </div>
  );
}

/** The version waiting for a person to deploy it, exactly as it would run. */
function ReviewSection({
  agent,
  review,
}: {
  agent: Agent;
  review: NonNullable<Agent["reviewVersion"]>;
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
    "Agent deployed to the team.",
  );
  return (
    <SettingsSection
      title={`Version ${review.number} is waiting for review`}
      description={
        agent.status === "DRAFT"
          ? "This is a draft. Deploy it to the team before you change what it can do."
          : undefined
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
        <AgentCode agentId={agent.id} versionId={review.id} editable={false} />
      </div>
    </SettingsSection>
  );
}
