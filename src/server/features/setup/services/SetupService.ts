import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { clientStatus } from "@/server/features/mailbox/providers/oauth";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { SetupRepository } from "@/server/features/setup/repositories/SetupRepository";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { AgentAvailability } from "@/shared/agent-availability";

// The gateway's keys for the agent, as General's settings rows show them:
// whether each is there and, while it isn't, how it gets there. Nothing here
// is ever a key: the gateway holds them all, and on a fork an owner or admin
// sets each with one command.

/** Set up, being found out (the gateway is connected, nothing asked yet), or not. */
type SetupState = "done" | "checking" | "missing";

type KeySpec = {
  id: "model" | "context";
  /** The gateway setting an operator sets (`everyapp secret set … --for gateway`). */
  setting: string;
  check: (availability: AgentAvailability) => SetupState;
  /** Why it isn't set up, when there is more to say than "it isn't". */
  note?: (availability: AgentAvailability) => string | null;
};

const KEYS: KeySpec[] = [
  {
    id: "model",
    setting: "OPENROUTER_API_KEY",
    check: (availability) =>
      availability.model === "ready"
        ? "done"
        : availability.model === "unchecked"
          ? "checking"
          : "missing",
    note: (availability) => {
      if (availability.model === "missing") {
        return "In local development, put OPENROUTER_API_KEY in .dev.vars.";
      }
      return availability.modelRefusal;
    },
  },
  {
    id: "context",
    setting: "CONTEXT_API_KEY",
    check: (availability) => (availability.context ? "done" : "missing"),
  },
];

type SetupItem = {
  id: KeySpec["id"];
  state: SetupState;
  note: string | null;
  /** The command that sets it up: on a fork, for owners and admins. */
  command: string | null;
};

/**
 * The gateway's keys for the organization. Commands are shown on a fork, where
 * the organization runs its own gateway, and only to those who `canManage`;
 * on the first-party deployment Every App runs the gateway.
 */
async function checklist(
  organizationId: string,
  canManage: boolean,
): Promise<{
  items: SetupItem[];
  tier: AgentAvailability["tier"];
  /** `everyapp dev`: the keys come from .dev.vars, not a gateway. */
  local: boolean;
}> {
  const [availability, dev] = await Promise.all([
    AgentAvailabilityService.forOrganization(organizationId),
    getOptionalEnvValue("EVERYAPP_DEV"),
  ]);
  const local = Boolean(dev);
  // Only a fork's own gateway takes keys: the hosted CRM runs on Every App's,
  // so it shows no setup at all, even in local development. A fork's keys go
  // in .dev.vars locally (each item's note says so), else by command.
  const fork = availability.tier === "fork";
  const showCommands = canManage && fork && !local;
  const items = KEYS.map((spec): SetupItem => {
    const state = spec.check(availability);
    return {
      id: spec.id,
      state,
      note:
        state === "done" || !fork
          ? null
          : (spec.note?.(availability) ??
            (local && state === "missing"
              ? `In local development, put ${spec.setting} in .dev.vars.`
              : null)),
      command:
        showCommands && state === "missing"
          ? `pnpm everyapp secret set ${spec.setting} --for gateway`
          : null,
    };
  });
  return { items, tier: availability.tier, local };
}

/** Get started's steps, in the order they are worth doing. */
type GetStartedStep =
  | "model"
  | "context"
  | "companies"
  | "inbox"
  | "agent"
  | "tracking"
  | "slack"
  | "team";

/**
 * Overview's Get started card: the steps this person can take, and which are
 * done. Owners and admins also get the workspace's steps and, where the
 * organization runs its own gateway, the gateway's keys. A step whose
 * gateway piece is missing on Every App's own gateway is left out: nobody
 * here could finish it.
 */
async function getStarted(
  organizationId: string,
  userId: string,
  canManage: boolean,
): Promise<{ steps: { id: GetStartedStep; done: boolean }[] }> {
  const [done, availability, google, microsoft, slackReady, slack] =
    await Promise.all([
      SetupRepository.progress(organizationId, userId),
      AgentAvailabilityService.forOrganization(organizationId),
      clientStatus("google"),
      clientStatus("microsoft"),
      SlackService.clientReady(),
      SlackService.isConnected(organizationId),
    ]);
  const ownGateway = canManage && availability.tier === "fork";
  const steps: ({ id: GetStartedStep; done: boolean } | false)[] = [
    // Done once the model has answered: a new fork's gateway is connected
    // before anyone knows whether it holds a key ("unchecked").
    ownGateway && { id: "model", done: availability.model === "ready" },
    ownGateway && { id: "context", done: availability.context },
    { id: "companies", done: done.companies },
    (google.ready || microsoft.ready || ownGateway) && {
      id: "inbox",
      done: done.inbox,
    },
    (availability.model !== "missing" || ownGateway) && {
      id: "agent",
      done: done.agent,
    },
    canManage && { id: "tracking", done: done.tracking },
    canManage && (slackReady || ownGateway) && { id: "slack", done: slack },
    canManage && { id: "team", done: done.team },
  ];
  return { steps: steps.filter((step) => step !== false) };
}

export const SetupService = { checklist, getStarted };
