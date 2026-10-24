import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { AgentAvailability } from "@/shared/agent-availability";

// The gateway's keys for the agent, as Settings → AI's rows show them:
// whether each is there and, while it isn't, what that costs and how it gets
// there. Nothing here is ever a key: the gateway holds them all, and an owner
// or admin sets each with one command, which everyone sees (a name, never a
// value) so a member knows what to ask for.

/** Set up, being found out (the gateway is connected, nothing asked yet), or not. */
type SetupState = "done" | "checking" | "missing";

type KeySpec = {
  id: "model" | "context";
  /** The gateway setting an operator sets (`everyapp secret set …`). */
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
    // The first words say what being unset costs. The gateway's own refusal
    // sentence is never relayed: it is written for its operator.
    note: (availability) => {
      switch (availability.model) {
        case "missing":
          return "Research is paused until the agent has a model. In local development, put OPENROUTER_API_KEY in .dev.vars.";
        case "refused":
          return "Research is paused: this Every App gateway holds no OpenRouter key yet.";
        case "unchecked":
          return "Checked on the agent's first run.";
        default:
          return null;
      }
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
  /** The command that sets it up; an owner or admin runs it. */
  command: string | null;
};

/** The gateway's keys for the organization, which runs its own gateway. */
async function checklist(organizationId: string): Promise<{
  items: SetupItem[];
  /** `everyapp dev`: the keys come from .dev.vars, not a gateway. */
  local: boolean;
}> {
  const [availability, dev] = await Promise.all([
    AgentAvailabilityService.forOrganization(organizationId),
    getOptionalEnvValue("EVERYAPP_DEV"),
  ]);
  const local = Boolean(dev);
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
      // The keys go in .dev.vars locally (each item's note says so), else by
      // command, shown until the key is known to be there.
      command:
        !local && state !== "done"
          ? `pnpm everyapp secret set ${spec.setting}`
          : null,
    };
  });
  return { items, local };
}

export const SetupService = { checklist };
