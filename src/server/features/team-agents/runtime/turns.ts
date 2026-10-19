import type {
  FilePart,
  ModelMessage,
  ToolSet,
  UIMessage,
  UserModelMessage,
} from "ai";
import { env } from "cloudflare:workers";
import { reverse } from "remeda";
import { z } from "zod";
import {
  RUNTIME_INSTRUCTIONS,
  CHAT_TITLE_INSTRUCTION,
} from "@/server/features/agent/prompt/instructions";
import type { SpendSink } from "@/server/billing/spendSink";
import type { Spend } from "@/server/features/agent/runtime/budget";
import type {
  ChatSession,
  RunSession,
} from "@/server/features/agent/runtime/session";
import { scopeTools } from "@/server/features/agent/tools/registry";
import { builderCommandType } from "@/shared/builder-command";
import { agentManifest } from "@/shared/team-agents";
import { AgentRunRepository } from "../repositories/AgentRunRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
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

/**
 * A run's steps and research budget. Its tokens are capped as the CRM capped
 * its runner's (agent/runtime/budget.ts), and the CRM set no step limit, so
 * this one is only a safety bound: every step re-reads the run's
 * instructions, tools and transcript, so its 500,000 input tokens run out
 * long before its hundredth step.
 */
export const RUN_LIMITS = {
  maxSteps: 100,
  /** Research units: two quick web questions. */
  budget: 2,
} as const;

export const RUN_STOPPED_REPLY =
  "This run is no longer active, so it does nothing.";

/**
 * A run's turn: the runner's instructions and the version's approved ones,
 * with the version's tools. Null when the run is no longer RUNNING (it was
 * stopped): the turn then says so and does nothing.
 */
export async function prepareRunTurn(
  session: RunSession,
  input: { thinkSystem: string; spend: Spend; sink: SpendSink },
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
      runId: run.id,
      manifest: manifest.data,
      spend: input.spend,
    }),
    input.sink,
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

// What the person sends reaches the model as the CRM's builder delivers a
// submission (custom-agent-dispatch.ts, builderDeliveryMessage): the labels
// of the records and integrations they tagged on a line before their text,
// and the files they attached as file parts. The files here are the images
// and PDFs, which the model reads itself (OpenRouter hands a PDF to a model
// that reads PDFs, and parses it first for one that doesn't); read_attachment
// reads a text file. Think stores the messages without either, so each turn
// adds them to the model messages Think assembled: files only from the
// messages Think replays in full (it hides older media from the model), and
// at most one message's worth, newest first.

/** The transcript's tail Think replays in full (truncateOlderMessages). */
const RECENT_MESSAGES = 4;
/** The most file bytes a turn sends: one message's most, five files of 2 MB. */
const FILE_BUDGET_BYTES = 5 * 2_000_000;
const FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/** One of the person's messages: its id, and what it tagged and attached. */
type PersonMessage = { id: string } & Required<z.infer<typeof messageExtras>>;

/** The file parts of the recent messages' images and PDFs, by message. */
async function attachedFiles(
  session: ChatSession,
  recent: readonly PersonMessage[],
): Promise<Map<string, FilePart[]>> {
  const wanted = reverse(recent).flatMap((message) =>
    message.attachments.map((file) => ({
      messageId: message.id,
      id: file.id,
    })),
  );
  const files = new Map<string, FilePart[]>();
  if (wanted.length === 0) return files;
  const rows = new Map(
    (
      await BuilderRepository.listAttachments(
        session.organizationId,
        session.conversation.id,
      )
    ).map((row) => [row.id, row]),
  );
  let room = FILE_BUDGET_BYTES;
  const chosen = wanted.flatMap(({ messageId, id }) => {
    const row = rows.get(id);
    if (!row || !FILE_TYPES.has(row.mediaType.toLowerCase())) return [];
    if (row.size > room) return [];
    room -= row.size;
    return [{ messageId, row }];
  });
  const loaded = await Promise.all(
    chosen.map(async ({ messageId, row }) => {
      const object = await env.R2.get(row.storageKey);
      if (!object) return null;
      const part: FilePart = {
        type: "file",
        data: new Uint8Array(await object.arrayBuffer()),
        mediaType: row.mediaType,
        filename: row.name,
      };
      return { messageId, part };
    }),
  );
  for (const found of loaded) {
    if (!found) continue;
    files.set(found.messageId, [
      ...(files.get(found.messageId) ?? []),
      found.part,
    ]);
  }
  return files;
}

/**
 * Think's model messages for the turn with the person's tags and files
 * added. Think turns each of the person's messages into one user message, in
 * order, so they pair up from the end.
 */
async function withTagsAndFiles(
  session: ChatSession,
  transcript: readonly UIMessage[],
  people: readonly PersonMessage[],
  assembled: ModelMessage[],
): Promise<ModelMessage[]> {
  const recentIds = new Set(
    transcript.slice(-RECENT_MESSAGES).map((message) => message.id),
  );
  const files = await attachedFiles(
    session,
    people.filter((person) => recentIds.has(person.id)),
  );
  let index =
    people.length -
    assembled.filter((message) => message.role === "user").length;
  return assembled.map((message): ModelMessage => {
    if (message.role !== "user") return message;
    const person = people[index];
    index += 1;
    if (!person) return message;
    const labels = person.resources
      .map((resource) => resource.label.trim())
      .filter(Boolean);
    const attached = files.get(person.id) ?? [];
    if (labels.length === 0 && attached.length === 0) return message;
    const parts: Exclude<UserModelMessage["content"], string> =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    // The CRM's line before the person's text: `Tagged resources: Acme, Slack`.
    const line = `Tagged resources: ${labels.join(", ")}`;
    const [first, ...rest] = parts;
    const tagged =
      labels.length === 0
        ? parts
        : first?.type === "text"
          ? [{ ...first, text: `${line}\n\n${first.text}` }, ...rest]
          : [{ type: "text" as const, text: line }, ...parts];
    return { ...message, content: [...tagged, ...attached] };
  });
}

/**
 * A builder chat's turn: a question, or (when the person's latest message
 * asks for an agent, builder-command.ts) a build. The records the person
 * tagged and the files they attached ride on their messages' metadata; the
 * tools re-check every tagged record against the organization before
 * anything is saved. A question's research draws on the turn's budget.
 * `messages` gives the model what the person tagged and attached, from the
 * model messages Think assembled for the turn (TurnContext.messages), and
 * `creating` says whether the turn builds, which has its own token limit.
 */
export function prepareBuilderTurn(
  session: ChatSession,
  input: {
    thinkSystem: string;
    messages: readonly UIMessage[];
    spend: Spend;
    sink: SpendSink;
  },
): {
  system: string;
  tools: ToolSet;
  messages: (assembled: ModelMessage[]) => Promise<ModelMessage[]>;
  creating: boolean;
} {
  const userMessages = input.messages.filter(
    (message) => message.role === "user",
  );
  const people: PersonMessage[] = userMessages.map((message) => {
    const { resources = [], attachments = [] } = messageExtras.parse(
      message.metadata,
    );
    return { id: message.id, resources, attachments };
  });
  const resources = people.flatMap((person) => person.resources);
  const tagged = resources.flatMap((resource) =>
    resource.kind === "integration"
      ? []
      : [{ kind: resource.kind, id: resource.id }],
  );
  const taggedIntegrations = resources.flatMap((resource) =>
    resource.kind === "integration" ? [resource.id] : [],
  );
  const attachments = people.flatMap((person) => person.attachments);
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
    input.sink,
  );
  return {
    system,
    tools,
    messages: (assembled) =>
      withTagsAndFiles(session, input.messages, people, assembled),
    creating,
  };
}
