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
import { SETTINGS_BILLING_ROUTE } from "@/shared/billing";

// What every screen showing the agent's progress says when the agent can't
// run: the records it would research wait for its model to be set up on the
// gateway, or for the workspace's credits, and nothing pretends to be
// working on them. Each says so in one line, with where it is fixed.

const OUT_OF_CREDITS = "The workspace is out of credits.";

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
 * The agent's model isn't set up, and who sets it up: Settings → General for
 * an owner or admin, an owner or admin for everyone else.
 */
export function ModelNotSetUp() {
  const canManage = useCanManageWorkspace();
  return (
    <>
      The agent's model isn't set up.{" "}
      {canManage ? (
        <Link to="/settings" className={LINK}>
          Set it up in Settings → General
        </Link>
      ) : (
        "An owner or admin can set it up."
      )}
    </>
  );
}

/** Why the agent is paused, in one line: the credits, or its model. */
export function PausedReason() {
  const outOfCredits = useAgentAvailability()?.outOfCredits;
  if (!outOfCredits) return <ModelNotSetUp />;
  return (
    <>
      {OUT_OF_CREDITS} <BillingLink />
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
        className="inline-flex cursor-help items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <ModelNotSetUp />
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** The record's agent tab: its research waits for credits. */
export function OutOfCredits() {
  return (
    <p className="text-xs text-muted-foreground">
      {OUT_OF_CREDITS} <BillingLink />
    </p>
  );
}

function BillingLink() {
  return (
    <Link to={SETTINGS_BILLING_ROUTE} className={LINK}>
      Go to Billing
    </Link>
  );
}
