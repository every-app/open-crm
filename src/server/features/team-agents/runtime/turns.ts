import type { StopCondition, ToolSet, UIMessage } from "ai";
import { z } from "zod";
import {
  RUNTIME_INSTRUCTIONS,
  CHAT_TITLE_INSTRUCTION,
} from "@/server/features/agent/prompt/instructions";
import type { Spend } from "@/server/features/agent/runtime/budget";
import type {
  ChatSession,
  RunSession,
} from "@/server/features/agent/runtime/session";
import { scopeTools } from "@/server/features/agent/tools/registry";
import { builderCommandType } from "@/shared/builder-command";
import { agentManifest } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { builderTools } from "./builderTools";
import {
  approvedInstructions,
  BUILDER_INSTRUCTIONS,
  CHAT_TURN_INSTRUCTIONS,
  CREATE_TURN_INSTRUCTIONS,
  RUNNER_INSTRUCTIONS,
} from "./prompts";
import { runnerTools } from "./runnerTools";

// One turn's system prompt and tools for the two team-agent sessions the
// CrmAgent runtime holds beside research and record chats (CrmAgent
// beforeTurn): a run of a deployed version, and a builder chat.

/** A run's steps and tokens: tighter than a research session's. */
export const RUN_LIMITS = {
  maxSteps: 16,
  maxOutputTokens: 4_000,
  /** Research units (two web searches). */
  budget: 4,
  /** A run that has read this much input stops where it is. */
  maxInputTokens: 300_000,
} as const;

export const RUN_STOPPED_REPLY =
  "This run is no longer active, so it does nothing.";

/** A run stops where it is once its steps have read this much input. */
export const withinRunInput: StopCondition<ToolSet> = ({ steps }) =>
  steps.reduce((total, step) => total + (step.usage.inputTokens ?? 0), 0) >
  RUN_LIMITS.maxInputTokens;

/**
 * A run's turn: the runner's instructions and the version's approved ones,
 * with the version's tools. Null when the run is no longer RUNNING (it was
 * stopped): the turn then says so and does nothing.
 */
export async function prepareRunTurn(
  session: RunSession,
  input: { thinkSystem: string; spend: Spend },
): Promise<{ system: string; tools: ToolSet } | null> {
  const run = await AgentRunRepository.findWithVersion(
    session.organizationId,
    session.run.id,
  );
  if (run?.status !== "RUNNING") return null;
  const manifest = agentManifest.safeParse(run.manifest);
  if (!manifest.success) return null;
  const system = [
    RUNTIME_INSTRUCTIONS,
    RUNNER_INSTRUCTIONS,
    approvedInstructions(run.instructions),
    `# This run\n\nAgent: ${run.agentName} (version ${run.versionNumber}). Trigger: ${run.triggerType}. Now: ${new Date().toISOString()}.`,
    input.thinkSystem,
  ]
    .filter(Boolean)
    .join("\n\n");
  const tools = scopeTools(
    session,
    runnerTools({
      organizationId: session.organizationId,
      sessionId: session.sessionId,
      runId: run.id,
      manifest: manifest.data,
      spend: input.spend,
    }),
  );
  return { system, tools };
}

/** The message that starts a run's session. */
export function runBrief(runId: string): string {
  return `Execute deployed agent run ${runId}. Call inspect_run first.`;
}

const messageExtras = z
  .object({
    resources: z
      .array(
        z.object({
          kind: z.enum(["company", "contact", "deal", "integration"]),
          id: z.string().min(1),
          label: z.string(),
        }),
      )
      .max(20)
      .catch([]),
    attachments: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          mediaType: z.string(),
        }),
      )
      .max(5)
      .catch([]),
  })
  .partial()
  .catch({});

function textOf(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

/**
 * A builder chat's turn: a question, or (when the person's latest message
 * asks for an agent, builder-command.ts) a build. The records the person
 * tagged and the files they attached ride on their messages' metadata; the
 * tools re-check every tagged record against the organization before
 * anything is saved. A question's research draws on the turn's budget.
 */
export function prepareBuilderTurn(
  session: ChatSession,
  input: { thinkSystem: string; messages: readonly UIMessage[]; spend: Spend },
): { system: string; tools: ToolSet } {
  const userMessages = input.messages.filter(
    (message) => message.role === "user",
  );
  const extras = userMessages.map((message) =>
    messageExtras.parse(message.metadata),
  );
  const resources = extras.flatMap((extra) => extra.resources ?? []);
  const tagged = resources.flatMap((resource) =>
    resource.kind === "integration"
      ? []
      : [{ kind: resource.kind, id: resource.id }],
  );
  const taggedIntegrations = resources.flatMap((resource) =>
    resource.kind === "integration" ? [resource.id] : [],
  );
  const attachments = extras.flatMap((extra) => extra.attachments ?? []);
  const last = userMessages.at(-1);
  const creating = last
    ? builderCommandType(textOf(last)) === "CREATE_AGENT"
    : false;
  const needsTitle = !session.conversation.title;
  const system = [
    RUNTIME_INSTRUCTIONS,
    BUILDER_INSTRUCTIONS,
    needsTitle ? CHAT_TITLE_INSTRUCTION : "",
    attachments.length > 0
      ? `# Attached files\n\n${attachments.map((file) => `- ${file.name} (${file.mediaType}), id ${file.id}`).join("\n")}`
      : "",
    creating ? CREATE_TURN_INSTRUCTIONS : CHAT_TURN_INSTRUCTIONS,
    input.thinkSystem,
  ]
    .filter(Boolean)
    .join("\n\n");
  const tools = scopeTools(
    session,
    builderTools({
      organizationId: session.organizationId,
      userId: session.conversation.userId,
      conversationId: session.conversation.id,
      tagged,
      taggedIntegrations,
      creating,
      agentContext: {
        organizationId: session.organizationId,
        sessionId: session.sessionId,
        record: session.record,
        task: null,
        conversation: { id: session.conversation.id, needsTitle },
        attended: true,
        role: null,
        spend: input.spend,
      },
    }),
  );
  return { system, tools };
}
