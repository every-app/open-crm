import type { RecordRef } from "@/shared/records";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { BuilderToolService } from "./BuilderToolService";
import type { DraftInput } from "./draft";
import { TeamAgentService } from "./TeamAgentService";

// The team agent service tests' shared setup: people in org_a and org_b, a
// draft with overrides, and that draft saved from a builder chat or deployed.
// The test files mock the database modules this imports.

export const owner = {
  organizationId: "org_a",
  userId: "user_a",
  role: "owner",
};
export const member = {
  organizationId: "org_a",
  userId: "user_c",
  role: "member",
};
export const outsider = {
  organizationId: "org_b",
  userId: "user_b",
  role: "owner",
};

export const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  name: "Stage watcher",
  description: "Summarizes deals that move.",
  instructions:
    "When a deal changes stage, read it and write a one-line summary of where it stands.",
  triggers: [
    { type: "MANUAL", name: "By hand", summary: "When someone runs it" },
  ],
  recordScope: "WORKSPACE",
  resources: [],
  integrations: [],
  actions: [{ type: "run.summary", provider: "crm", summary: "Summarize" }],
  ...overrides,
});

/** A builder chat that saved `input`: its agent and version ids. */
export async function saved(input: DraftInput, tagged: RecordRef[] = []) {
  const chat = await BuilderRepository.createConversation({
    organizationId: "org_a",
    userId: "user_a",
    sessionId: `chat.test.${crypto.randomUUID()}`,
  });
  const result = await BuilderToolService.saveDraft(
    {
      organizationId: "org_a",
      userId: "user_a",
      conversationId: chat.id,
      tagged,
      taggedIntegrations: [],
    },
    input,
  );
  if (!result.saved) throw new Error(result.issues.join(" "));
  return result;
}

/** `input` saved and deployed by the owner. */
export async function live(
  input: DraftInput = draft(),
  tagged: RecordRef[] = [],
) {
  const version = await saved(input, tagged);
  await TeamAgentService.deploy(owner, {
    agentId: version.agentId,
    versionId: version.versionId,
    clientRequestId: crypto.randomUUID(),
  });
  return version;
}
