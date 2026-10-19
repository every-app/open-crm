import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { clientStatus } from "@/server/features/mailbox/providers/oauth";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { SetupRepository } from "@/server/features/setup/repositories/SetupRepository";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { AgentAvailability } from "@/shared/agent-availability";

// The gateway's keys for the agent, as General's settings rows show them:
// whether each is there and, while it isn't, how it gets there. Nothing here
// is ever a key: the gateway holds them all, and an owner or admin sets each
// with one command.

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
  /** The command that sets it up, for owners and admins. */
  command: string | null;
};

/**
 * The gateway's keys for the organization, which runs its own gateway.
 * Commands are shown only to those who `canManage`.
 */
async function checklist(
  organizationId: string,
  canManage: boolean,
): Promise<{
  items: SetupItem[];
  /** `everyapp dev`: the keys come from .dev.vars, not a gateway. */
  local: boolean;
}> {
  const [availability, dev] = await Promise.all([
    AgentAvailabilityService.forOrganization(organizationId),
    getOptionalEnvValue("EVERYAPP_DEV"),
  ]);
  const local = Boolean(dev);
  // The keys go in .dev.vars locally (each item's note says so), else by
  // command.
  const showCommands = canManage && !local;
  const items = KEYS.map((spec): SetupItem => {
    const state = spec.check(availability);
    return {
      id: spec.id,
      state,
      note:
        state === "done"
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
  return { items, local };
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
 * done. Owners and admins, who run the organization's gateway, also get the
 * workspace's steps and the gateway's keys. For a member, a step whose
 * gateway piece is missing is left out: they couldn't finish it.
 */
async function getStarted(
  organizationId: string,
  userId: string,
  canManage: boolean,
): Promise<{ steps: { id: GetStartedStep; done: boolean }[] }> {
  const [done, availability, google, microsoft, slack] = await Promise.all([
    SetupRepository.progress(organizationId, userId),
    AgentAvailabilityService.forOrganization(organizationId),
    clientStatus("google"),
    clientStatus("microsoft"),
    SlackService.isConnected(organizationId),
  ]);
  const steps: ({ id: GetStartedStep; done: boolean } | false)[] = [
    // Done once the model has answered: a new gateway is connected before
    // anyone knows whether it holds a key ("unchecked").
    canManage && { id: "model", done: availability.model === "ready" },
    canManage && { id: "context", done: availability.context },
    { id: "companies", done: done.companies },
    (google.ready || microsoft.ready || canManage) && {
      id: "inbox",
      done: done.inbox,
    },
    (availability.model !== "missing" || canManage) && {
      id: "agent",
      done: done.agent,
    },
    canManage && { id: "tracking", done: done.tracking },
    canManage && { id: "slack", done: slack },
    canManage && { id: "team", done: done.team },
  ];
  return { steps: steps.filter((step) => step !== false) };
}

export const SetupService = { checklist, getStarted };
