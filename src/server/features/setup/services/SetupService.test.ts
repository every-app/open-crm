import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAvailability } from "@/shared/agent-availability";

vi.mock("@/server/features/agent/services/AgentAvailabilityService", () => ({
  AgentAvailabilityService: { forOrganization: vi.fn() },
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: vi.fn() }));

import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { SetupService } from "./SetupService";

const keysMissing: AgentAvailability = {
  model: "missing",
  modelRefusal: null,
  context: false,
  scheduledResearch: true,
};

describe("SetupService.checklist", () => {
  beforeEach(() => {
    // `everyapp dev`.
    vi.mocked(getOptionalEnvValue).mockResolvedValue("1");
    vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue(
      keysMissing,
    );
  });

  it("tells local development where each missing key goes", async () => {
    const { items } = await SetupService.checklist("org_a");
    expect(items.map((item) => item.note)).toEqual([
      "Research is paused until the agent has a model. In local development, put OPENROUTER_API_KEY (or another model provider's key) in .dev.vars.",
      "In local development, put CONTEXT_API_KEY in .dev.vars.",
    ]);
    expect(items.map((item) => item.command)).toEqual([null, null]);
  });

  it("gives everyone the command while a key isn't known to be there", async () => {
    vi.mocked(getOptionalEnvValue).mockResolvedValue(undefined);
    vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue({
      ...keysMissing,
      model: "refused",
      modelRefusal:
        "Provider is not configured: the gateway needs OPENROUTER_API_KEY for openrouter.",
    });
    const { items } = await SetupService.checklist("org_a");
    expect(items[0]).toEqual({
      id: "model",
      state: "missing",
      note: "Research is paused: this Every App gateway has no model provider set up yet.",
      command: "pnpm everyapp secret set OPENROUTER_API_KEY",
    });
    expect(items[1]?.command).toBe("pnpm everyapp secret set CONTEXT_API_KEY");
  });

  it("says the first run checks the model while nothing has asked it yet", async () => {
    vi.mocked(getOptionalEnvValue).mockResolvedValue(undefined);
    vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue({
      ...keysMissing,
      model: "unchecked",
    });
    const { items } = await SetupService.checklist("org_a");
    expect(items[0]).toEqual({
      id: "model",
      state: "checking",
      note: "Checked on the agent's first run.",
      command: "pnpm everyapp secret set OPENROUTER_API_KEY",
    });
  });
});
