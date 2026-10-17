import type { StopCondition, ToolSet, UIMessage } from "ai";
import { z } from "zod";
import {
  RUNTIME_INSTRUCTIONS,
  CHAT_TITLE_INSTRUCTION,
} from "@/server/features/agent/prompt/instructions";
import { FREE, type Spend } from "@/server/features/agent/runtime/budget";
import type {
  ChatSession,
  RunSession,
} from "@/server/features/agent/runtime/session";
import { scopeTools } from "@/server/features/agent/tools/registry";
import { agentManifest } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { builderTools } from "./builderTools";
import {
  approvedInstructions,
  BUILDER_INSTRUCTIONS,
  isCreateAgentCommand,
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
): Promise<{ system: string; tools: ToolSet; modelId: string } | null> {
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
  return { system, tools, modelId: run.versionModelId };
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
 * A builder chat's turn. The records the person tagged and the files they
 * attached ride on their messages' metadata; the tools re-check every
 * tagged record against the organization before anything is saved.
 */
export function prepareBuilderTurn(
  session: ChatSession,
  input: { thinkSystem: string; messages: readonly UIMessage[] },
): { system: string; tools: ToolSet } {
  const userMessages = input.messages.filter(
    (message) => message.role === "user",
  );
  const extras = userMessages.map((message) =>
    messageExtras.parse(message.metadata),
  );
  const tagged = extras.flatMap((extra) =>
    (extra.resources ?? []).flatMap((resource) =>
      resource.kind === "integration"
        ? []
        : [{ kind: resource.kind, id: resource.id }],
    ),
  );
  const attachments = extras.flatMap((extra) => extra.attachments ?? []);
  const last = userMessages.at(-1);
  const creating = last ? isCreateAgentCommand(textOf(last)) : false;
  const needsTitle = !session.conversation.title;
  const system = [
    RUNTIME_INSTRUCTIONS,
    BUILDER_INSTRUCTIONS,
    needsTitle ? CHAT_TITLE_INSTRUCTION : "",
    attachments.length > 0
      ? `# Attached files\n\n${attachments.map((file) => `- ${file.name} (${file.mediaType}), id ${file.id}`).join("\n")}`
      : "",
    creating
      ? "This turn is a /Create agent request: the build tools are available."
      : "This turn is a question, not a /Create agent request: answer it, and say how to ask for an agent if one is wanted.",
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
      sessionId: session.sessionId,
      needsTitle,
      creating,
      agentContext: {
        organizationId: session.organizationId,
        sessionId: session.sessionId,
        record: session.record,
        task: null,
        conversation: { id: session.conversation.id, needsTitle },
        attended: true,
        role: null,
        spend: FREE,
      },
    }),
  );
  return { system, tools };
}
