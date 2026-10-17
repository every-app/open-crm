import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { AgentAvailability } from "@/shared/agent-availability";

// The setup checklist: what this gateway has set up for the CRM and what
// each piece unlocks. An item is one entry in SETUP_ITEMS: what it is, what
// it unlocks, the gateway setting behind it, and how to tell whether it is
// set up. Nothing here is ever a key: the gateway holds them all, and on a
// fork an owner or admin sets each with one command.

/** Set up, being found out (the gateway is connected, nothing asked yet), or not. */
type SetupState = "done" | "checking" | "missing";

type SetupContext = {
  organizationId: string;
  availability: AgentAvailability;
};

type SetupItemSpec = {
  id: string;
  /** The settings page section the item belongs to. */
  group: "agent";
  title: string;
  unlocks: string;
  /** The gateway setting an operator sets (`everyapp secret set … --for gateway`). */
  setting: string;
  check: (context: SetupContext) => SetupState | Promise<SetupState>;
  /** Why it isn't set up, when there is more to say than "it isn't". */
  note?: (context: SetupContext) => string | null;
};

const SETUP_ITEMS: SetupItemSpec[] = [
  {
    id: "model",
    group: "agent",
    title: "The agent's model",
    unlocks:
      "The research agent: company and contact research, custom fields it fills, and chats on every record.",
    setting: "OPENROUTER_API_KEY",
    check: ({ availability }) =>
      availability.model === "ready"
        ? "done"
        : availability.model === "unchecked"
          ? "checking"
          : "missing",
    note: ({ availability }) => {
      if (availability.model === "missing") {
        return "This deployment isn't connected to a gateway. In local development, put OPENROUTER_API_KEY in .dev.vars.";
      }
      if (availability.model === "unchecked") {
        return "The gateway is connected; the agent finds out whether it holds a model key the next time it runs.";
      }
      return availability.modelRefusal;
    },
  },
  {
    id: "context",
    group: "agent",
    title: "Context.dev",
    unlocks:
      "Company logos and brand data, LinkedIn profiles, and reading company websites.",
    setting: "CONTEXT_API_KEY",
    check: ({ availability }) => (availability.context ? "done" : "missing"),
  },
];

type SetupItem = {
  id: string;
  group: SetupItemSpec["group"];
  title: string;
  unlocks: string;
  state: SetupState;
  note: string | null;
  /** The command that sets it up: on a fork, for owners and admins. */
  command: string | null;
};

/**
 * The checklist for the organization. Commands are shown on a fork, where
 * the organization runs its own gateway, and only to those who `canManage`;
 * on the first-party deployment Every App runs the gateway.
 */
async function checklist(
  organizationId: string,
  canManage: boolean,
): Promise<{
  items: SetupItem[];
  complete: boolean;
  dismissed: boolean;
  tier: AgentAvailability["tier"];
  /** `everyapp dev`: the keys come from .dev.vars, not a gateway. */
  local: boolean;
}> {
  const [availability, workspace, dev] = await Promise.all([
    AgentAvailabilityService.forOrganization(organizationId),
    WorkspaceRepository.getOrCreate(organizationId),
    getOptionalEnvValue("EVERYAPP_DEV"),
  ]);
  const local = Boolean(dev);
  const context = { organizationId, availability };
  const showCommands = canManage && availability.tier === "fork";
  const items = await Promise.all(
    SETUP_ITEMS.map(async (spec): Promise<SetupItem> => {
      const state = await spec.check(context);
      return {
        id: spec.id,
        group: spec.group,
        title: spec.title,
        unlocks: spec.unlocks,
        state,
        note:
          state === "done"
            ? null
            : (spec.note?.(context) ??
              (local && state === "missing"
                ? `In local development, put ${spec.setting} in .dev.vars.`
                : null)),
        command:
          showCommands && state === "missing"
            ? `pnpm everyapp secret set ${spec.setting} --for gateway`
            : null,
      };
    }),
  );
  return {
    items,
    complete: items.every((item) => item.state === "done"),
    dismissed: workspace.setupDismissedAt !== null,
    tier: availability.tier,
    local,
  };
}

/** Puts the checklist away on Home; Settings keeps showing it. */
async function dismiss(organizationId: string): Promise<void> {
  await WorkspaceRepository.update(organizationId, {
    setupDismissedAt: new Date().toISOString(),
  });
}

export const SetupService = { checklist, dismiss };
