import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAvailability,
  DeploymentTier,
} from "@/shared/agent-availability";

// Setup is a self-hosted copy's: the hosted CRM runs on Every App's gateway,
// so its checklist offers no command and no .dev.vars hint, even in local
// development, while a fork's says where each missing key goes.
vi.mock("@/server/features/agent/services/AgentAvailabilityService", () => ({
  AgentAvailabilityService: { forOrganization: vi.fn() },
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: vi.fn() }));
vi.mock("@/server/features/mailbox/providers/oauth", () => ({
  clientStatus: vi.fn(),
}));
vi.mock("@/server/features/slack/services/SlackService", () => ({
  SlackService: { clientReady: vi.fn(), isConnected: vi.fn() },
}));
vi.mock("@/server/features/setup/repositories/SetupRepository", () => ({
  SetupRepository: { progress: vi.fn() },
}));

import { AgentAvailabilityService } from "@/server/features/agent/services/AgentAvailabilityService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { SetupService } from "./SetupService";

const keysMissing = (tier: DeploymentTier): AgentAvailability => ({
  model: "missing",
  modelRefusal: null,
  context: false,
  outOfCredits: false,
  scheduledResearch: true,
  tier,
});

describe("SetupService.checklist", () => {
  beforeEach(() => {
    // `everyapp dev`.
    vi.mocked(getOptionalEnvValue).mockResolvedValue("1");
    vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue(
      keysMissing("fork"),
    );
  });

  it("shows the hosted CRM no setup, even in local development", async () => {
    vi.mocked(AgentAvailabilityService.forOrganization).mockResolvedValue(
      keysMissing("first_party"),
    );
    const { items } = await SetupService.checklist("org_a", true);
    expect(items.map(({ note, command }) => ({ note, command }))).toEqual([
      { note: null, command: null },
      { note: null, command: null },
    ]);
  });

  it("tells a self-hosted copy where each missing key goes", async () => {
    const { items } = await SetupService.checklist("org_a", true);
    expect(items.map((item) => item.note)).toEqual([
      "In local development, put OPENROUTER_API_KEY in .dev.vars.",
      "In local development, put CONTEXT_API_KEY in .dev.vars.",
    ]);
  });
});
