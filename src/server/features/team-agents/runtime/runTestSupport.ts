import { AgentVersionRepository } from "@/server/features/team-agents/repositories/AgentVersionRepository";
import type { AgentManifest } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";

// The run tests' shared setup: a manifest with overrides, and a deployed
// version of it with one RUNNING run in org_a. The test file mocks the
// database modules this imports.

export const ORG = "org_a";

export const summary = {
  type: "run.summary",
  provider: "crm",
  summary: "Summarize",
} as const;

export const manifest = (
  overrides: Partial<AgentManifest> = {},
): AgentManifest => ({
  name: "Agent",
  description: "Does a thing.",
  triggers: [{ type: "MANUAL", name: "By hand", summary: "By hand" }],
  dataScope: { mode: "WORKSPACE", summary: "Workspace", resources: [] },
  actions: [summary],
  access: [],
  ...overrides,
});

/** A deployed version of `value` with one RUNNING run: the run's id. */
export async function runningRun(value: AgentManifest): Promise<string> {
  const agentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await AgentVersionRepository.saveVersion({
    agent: {
      id: agentId,
      organizationId: ORG,
      name: value.name,
      description: value.description,
      createdById: "user_a",
      conversationId: null,
    },
    version: {
      id: versionId,
      organizationId: ORG,
      agentId,
      number: 1,
      status: "READY",
      instructions: "Do the thing.",
      manifest: value,
      modelId: "model",
      sourceConversationId: null,
      createdById: "user_a",
    },
    triggers: [],
    artifacts: [],
    claimedArtifactIds: [],
    audit: [],
  });
  await AgentVersionRepository.deploy({
    organizationId: ORG,
    agentId,
    versionId,
    name: value.name,
    description: null,
    audit: {
      organizationId: ORG,
      agentId,
      actorType: "USER",
      type: "agent.deployed",
      summary: "Deployed",
      requestId: crypto.randomUUID(),
    },
  });
  const run = await AgentRunRepository.insertIfAbsent({
    organizationId: ORG,
    agentId,
    versionId,
    triggerId: null,
    initiatedById: "user_a",
    triggerType: "MANUAL",
    idempotencyKey: crypto.randomUUID(),
    input: null,
  });
  await AgentRunRepository.claim(ORG, run.id, "model");
  return run.id;
}
