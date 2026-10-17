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
// working on them.

const OUT_OF_CREDITS = "The workspace is out of credits.";

/** What the agent has to work with; undefined until it has loaded. */
export function useAgentAvailability(): AgentAvailability | undefined {
  return useQuery(agentStatusQueryOptions()).data;
}

/** The agent can't run: its model isn't set up. False until known. */
export function useAgentPaused(): boolean {
  const availability = useAgentAvailability();
  return availability ? modelBlocked(availability.model) : false;
}

/** Why the agent can't run, in a sentence. */
export function agentPausedReason(availability: AgentAvailability): string {
  if (availability.outOfCredits) return OUT_OF_CREDITS;
  if (availability.model === "missing") {
    return "This deployment has no way to reach a model: it isn't connected to an Every App gateway (in local development, set OPENROUTER_API_KEY in .dev.vars).";
  }
  return "Your Every App gateway holds no key for the agent's model (OPENROUTER_API_KEY).";
}

/**
 * Where the pause is lifted: Billing, when the workspace is out of credits;
 * else where an owner or admin sets the agent up, and nothing for anyone else.
 */
export function AgentSetupLink({ className }: { className?: string }) {
  const canManage = useCanManageWorkspace();
  if (useAgentAvailability()?.outOfCredits) {
    return <BillingLink className={className} />;
  }
  if (!canManage) {
    return (
      <span className={className}>
        An owner or admin of the workspace can set it up.
      </span>
    );
  }
  return (
    <Link
      to="/settings"
      className={className ?? "text-foreground underline underline-offset-4"}
    >
      Set it up in Settings → General
    </Link>
  );
}

/**
 * "Waiting for setup" on a record whose research waits for the model, the
 * reason on hover or tap. Clicks stay here, so a list row doesn't open.
 */
export function WaitingForSetup() {
  const availability = useAgentAvailability();
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
          {availability
            ? agentPausedReason(availability)
            : "The agent's model isn't set up."}
        </p>
        <AgentSetupLink className="text-foreground underline underline-offset-4" />
      </PopoverContent>
    </Popover>
  );
}

/** The record's agent tab: its research waits for credits. */
export function OutOfCredits() {
  return (
    <p className="text-xs text-muted-foreground">
      {OUT_OF_CREDITS}{" "}
      <BillingLink className="text-foreground underline underline-offset-4" />
    </p>
  );
}

function BillingLink({ className }: { className?: string }) {
  return (
    <Link
      to={SETTINGS_BILLING_ROUTE}
      className={className ?? "text-foreground underline underline-offset-4"}
    >
      Go to Billing
    </Link>
  );
}
