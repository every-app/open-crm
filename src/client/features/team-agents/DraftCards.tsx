import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Play, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { runTeamAgent } from "@/serverFunctions/teamAgents";
import type { AgentManifest } from "@/shared/team-agents";
import { teamAgentKeys, teamAgentQueryOptions } from "./teamAgentQueries";

// The agent a builder chat makes, in the chat itself as the CRM shows it
// (agent-builder-chat.tsx): the build's progress, then the draft to review,
// or the live agent with a run and a follow-up. Each sits at the foot of the
// conversation, at every width; the files are AgentCodeWorkspace.tsx.

const BUILDER_STEPS = ["Scope", "Instructions", "Manifest", "Review"] as const;
const BUILDER_STEP_FILES = [
  null,
  "agent/instructions.md",
  "agent/manifest.json",
  "agent/README.md",
] as const;

/** The steps a build has done, from the files it has written so far. */
function completedSteps(written: ReadonlySet<string>): number {
  if (written.has("agent/README.md")) return 4;
  if (written.has("agent/manifest.json")) return 3;
  if (written.has("agent/instructions.md")) return 2;
  return 1;
}

/** While the builder works: its four steps, and the file it is writing. */
export function BuildingAgentCard({
  written,
  writing,
  onStop,
}: {
  /** The files this build has written. */
  written: ReadonlySet<string>;
  writing: string | null;
  onStop: () => void;
}) {
  const completed = completedSteps(written);
  return (
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-center gap-2 px-4 pt-4">
        <span className="min-w-0 flex-1 text-sm font-medium">
          Building the agent
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {completed} of 4
        </span>
      </div>
      <ol className="flex flex-col gap-1 p-3" aria-label="Agent creation">
        {BUILDER_STEPS.map((label, index) => {
          const done = index < completed;
          const active = index === completed;
          const file = BUILDER_STEP_FILES[index];
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-h-8 min-w-0 flex-col justify-center gap-1 rounded-md px-2",
                active && "bg-foreground/[0.04] py-2",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center font-mono text-xs",
                    done || active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" />
                  ) : active ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    done && file && "font-mono",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {done && file
                    ? file.replace("agent/", "")
                    : done
                      ? "Done"
                      : active
                        ? "Working"
                        : "Queued"}
                </span>
              </div>
              {active && writing ? (
                <p className="pl-7 font-mono text-xs text-muted-foreground">
                  Writing {writing}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <footer className="flex items-center gap-2 border-t border-border bg-foreground/[0.02] px-4 py-3">
        <p className="min-w-0 flex-1 text-xs text-pretty text-muted-foreground">
          Runs in the background
        </p>
        <Button variant="outline" size="sm" onClick={onStop}>
          Stop
        </Button>
      </footer>
    </div>
  );
}

/** A turn that ended in an error, with a retry. */
export function BuilderFailureCard({
  creatingAgent,
  retrying,
  onRetry,
}: {
  creatingAgent: boolean;
  retrying: boolean;
  onRetry: (() => void) | null;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-stretch gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-start"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {creatingAgent ? "Agent creation stopped" : "Response stopped"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The builder could not finish this request. Try again.
          </p>
        </div>
      </div>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          pending={retrying}
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function AgentCard({
  name,
  status,
  children,
}: {
  name: string;
  status: "Private" | "Live";
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h2 className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
          {name}
        </h2>
        <Badge variant={status === "Live" ? "success" : "secondary"}>
          {status}
        </Badge>
      </div>
      {children}
    </div>
  );
}

function CardFooter({
  note,
  children,
}: {
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 border-t border-border bg-foreground/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {note ? (
        <p className="min-w-0 text-xs text-pretty text-muted-foreground">
          {note}
        </p>
      ) : null}
      <div
        className={cn(
          "flex items-center gap-2 sm:shrink-0",
          !note && "justify-end sm:ml-auto",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-16 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function textOf(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

/** A summary without its closing parenthetical: "Every Monday". */
function compactSummary(value: string | undefined, fallback: string): string {
  return textOf(value, fallback).replace(/\s+\([^()]+\)\s*\.?$/, "");
}

/** What the review card says a version does, as the CRM's review card. */
function reviewOf(manifest: AgentManifest | null) {
  return {
    trigger:
      manifest?.triggers
        .map((trigger) =>
          trigger.type === "MANUAL"
            ? "On demand"
            : compactSummary(
                trigger.summary,
                trigger.type === "EVENT" ? "On CRM event" : "On schedule",
              ),
        )
        .join(" · ") || "On demand",
    looksAt: textOf(
      manifest?.dataScope.summary,
      "CRM records in the approved scope",
    ),
    action: compactSummary(
      manifest?.actions[0]?.summary,
      "Perform the requested team action",
    ),
    access: [...new Set(manifest?.access ?? [])],
  };
}

/** The saved draft, waiting for a person to review and deploy it. */
export function ReviewAgentCard({
  agentId,
  agentName,
  manifest,
}: {
  agentId: string;
  agentName: string;
  manifest: AgentManifest | null;
}) {
  const review = reviewOf(manifest);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm">Your private draft is ready to review.</p>
      <AgentCard name={manifest?.name.trim() || agentName} status="Private">
        <dl className="flex flex-col gap-2 p-4">
          <ReviewRow label="When">{review.trigger}</ReviewRow>
          <ReviewRow label="Find">{review.looksAt}</ReviewRow>
          <ReviewRow label="Then">{review.action}</ReviewRow>
          <ReviewRow label="Scope">
            {review.access.length === 0 ? (
              "Bounded CRM read access"
            ) : (
              <span className="flex min-w-0 flex-wrap gap-1">
                {review.access.map((scope) => (
                  <Badge
                    key={scope}
                    variant="secondary"
                    title={scope}
                    className="max-w-full"
                  >
                    <span className="truncate">{scope}</span>
                  </Badge>
                ))}
              </span>
            )}
          </ReviewRow>
        </dl>
        <CardFooter>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/agents/$agentId" params={{ agentId }} />}
          >
            View details
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardFooter>
      </AgentCard>
    </div>
  );
}

const NEXT_RUN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const FOLLOW_UPS = ["Add another teammate to the notification"];

/**
 * The agent is live: when it runs and whose it is, a run now, and a
 * follow-up the builder can make.
 */
export function DeployedAgentCard({
  agentId,
  onFollowUp,
}: {
  agentId: string;
  onFollowUp: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const agent = useQuery(teamAgentQueryOptions(agentId));
  const run = useMutation({
    mutationFn: () =>
      runTeamAgent({
        data: { agentId, clientRequestId: crypto.randomUUID() },
      }),
    onSuccess: async () => {
      toast.success("Agent run queued.");
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
    },
  });
  if (!agent.data) return null;
  const { name, createdBy, triggers } = agent.data;
  const enabled = triggers.filter((trigger) => trigger.enabled);
  const nextRunAt = enabled.length === 1 ? enabled[0]?.nextRunAt : null;
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1 text-sm">
        <p>{name} is live.</p>
        <p className="text-muted-foreground">
          I created the agent, applied its bounded CRM and integration access,
          and made it live for the team.
        </p>
      </div>
      <AgentCard name={name} status="Live">
        <dl className="flex flex-col gap-2 p-4">
          <ReviewRow label="Trigger">
            {nextRunAt ? (
              <time dateTime={nextRunAt}>
                {NEXT_RUN.format(new Date(nextRunAt))}
              </time>
            ) : (
              enabled.map((trigger) => trigger.name).join(" · ") ||
              "Manual only"
            )}
          </ReviewRow>
          <ReviewRow label="Owner">
            {createdBy ? `Team · ${createdBy}` : "Team"}
          </ReviewRow>
        </dl>
        <CardFooter note="The chat stays private. The agent is team-owned.">
          <Button
            variant="outline"
            size="sm"
            pending={run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? null : <Play data-icon="inline-start" />}
            {run.isPending ? "Queueing" : "Run now"}
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/agents/$agentId" params={{ agentId }} />}
          >
            Open agent
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardFooter>
      </AgentCard>
      <div>
        <p className="flex h-7 items-center text-sm text-muted-foreground">
          Suggested follow-ups
        </p>
        {FOLLOW_UPS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onFollowUp(suggestion)}
            className="flex w-full items-center gap-3 border-t border-border py-2.5 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03]"
          >
            <span className="min-w-0 flex-1 text-sm">{suggestion}</span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
