import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  agentStatusQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import {
  modelBlocked,
  type AgentAvailability,
} from "@/shared/agent-availability";

// What every screen showing the agent's progress says when the agent can't
// run: the records it would research wait for its model to be set up on the
// gateway, and nothing pretends to be working on them. Each says so in one
// line, with where it is fixed.

const LINK = "whitespace-nowrap text-foreground underline underline-offset-4";

/** What the agent has to work with; undefined until it has loaded. */
function useAgentAvailability(): AgentAvailability | undefined {
  return useQuery(agentStatusQueryOptions()).data;
}

/** The agent can't run: its model isn't set up. False until known. */
export function useAgentPaused(): boolean {
  const availability = useAgentAvailability();
  return availability ? modelBlocked(availability.model) : false;
}

/**
 * What Refresh research answers while the agent is paused: the request is
 * queued and runs by itself once the model is set up.
 */
export function pausedResearchMessage(canManage: boolean): string {
  return canManage
    ? "Queued. Research is paused until the agent's model is set up in Settings → AI."
    : "Queued. Research is paused until an owner or admin sets up the agent's model.";
}

/**
 * The agent's model isn't set up, and who sets it up: Settings → AI for an
 * owner or admin, an owner or admin for everyone else. `consequence` says
 * what that costs where it matters ("Runs fail until it is.").
 */
export function ModelNotSetUp({ consequence }: { consequence?: string }) {
  const canManage = useCanManageWorkspace();
  return (
    <>
      The agent's model isn't set up. {consequence ? `${consequence} ` : null}
      {canManage ? (
        <Link to="/settings/ai" hash="model" className={LINK}>
          Set up research
        </Link>
      ) : (
        "An owner or admin can set it up."
      )}
    </>
  );
}

/**
 * "Waiting for setup" on a record whose research waits for the model, the
 * reason on hover or tap. Clicks stay here, so a list row doesn't open.
 */
export function WaitingForSetup() {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex cursor-help items-center gap-1.5 rounded-sm text-xs whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
        Waiting for setup
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="gap-1.5 p-3 text-xs"
        onClick={(event) => event.stopPropagation()}
      >
        <PopoverTitle className="text-xs">The agent is paused</PopoverTitle>
        <p className="text-muted-foreground">
          <ModelNotSetUp consequence="Research resumes on its own once it is." />
        </p>
      </PopoverContent>
    </Popover>
  );
}
