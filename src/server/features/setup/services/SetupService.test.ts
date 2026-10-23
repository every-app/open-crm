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
    const { items } = await SetupService.checklist("org_a", true);
    expect(items.map((item) => item.note)).toEqual([
      "In local development, put OPENROUTER_API_KEY in .dev.vars.",
      "In local development, put CONTEXT_API_KEY in .dev.vars.",
    ]);
  });
});
