import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAvailability } from "@/shared/agent-availability";

vi.mock("@/server/features/agent/services/AgentAvailabilityService", () => ({
  AgentAvailabilityService: { forOrganization: vi.fn() },
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: vi.fn() }));
vi.mock("@/server/features/mailbox/providers/oauth", () => ({
  clientStatus: vi.fn(),
}));
vi.mock("@/server/features/slack/services/SlackService", () => ({
  SlackService: { isConnected: vi.fn() },
}));
vi.mock("@/server/features/setup/repositories/SetupRepository", () => ({
  SetupRepository: { progress: vi.fn() },
}));

import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { clientStatus } from "@/server/features/mailbox/providers/oauth";
import { SetupRepository } from "@/server/features/setup/repositories/SetupRepository";
import { SlackService } from "@/server/features/slack/services/SlackService";
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
    const { items } = await SetupService.checklist("org_a", true);
    expect(items.map((item) => item.note)).toEqual([
      "In local development, put OPENROUTER_API_KEY in .dev.vars.",
      "In local development, put CONTEXT_API_KEY in .dev.vars.",
    ]);
  });
});

describe("SetupService.getStarted", () => {
  beforeEach(() => {
    vi.mocked(SetupRepository.progress).mockResolvedValue({
      companies: false,
      inbox: false,
      agent: false,
      tracking: false,
      team: false,
    });
    vi.mocked(clientStatus).mockResolvedValue({ ready: false, clientId: null });
    vi.mocked(SlackService.isConnected).mockResolvedValue(false);
  });

  // A new gateway is connected before the agent has asked the model
  // anything, so "unchecked" isn't proof of a key.
  it("counts the model step done only once the model has answered", async () => {
    const modelStep = async (model: AgentAvailability["model"]) => {
      vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue({
        ...keysMissing,
        model,
      });
      const { steps } = await SetupService.getStarted("org_a", "u_a", true);
      return steps.find((step) => step.id === "model");
    };
    expect(await modelStep("unchecked")).toEqual({ id: "model", done: false });
    expect(await modelStep("ready")).toEqual({ id: "model", done: true });
  });
});
