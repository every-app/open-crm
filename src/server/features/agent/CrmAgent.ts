import { Think } from "@cloudflare/think";
import type {
  ChatErrorContext,
  ChatRecoveryContext,
  ChatRecoveryOptions,
  ChatResponseResult,
  Session,
  StepContext,
  ThinkSubmissionInspection,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think";
import { createCompactFunction } from "agents/experimental/memory/utils";
import { generateText } from "ai";
import { z } from "zod";
import { withPgClient } from "@/db";
import {
  openRouterCostUsd,
  staticAssistantModel,
} from "@/server/lib/chatAgent";
import { DEFAULT_AGENT_MODEL } from "@/server/lib/openrouter";
import { CHAT_ROLE_HEADER } from "./agentRoutes";
import { capabilityList, readCapabilities } from "./prompt/capabilities";
import { AgentConversationRepository } from "./repositories/AgentConversationRepository";
import { AgentProfileRepository } from "./repositories/AgentProfileRepository";
import { finalText, lastText, messageText, recordEvent } from "./runtime/audit";
import { researchBrief } from "./runtime/brief";
import { budgetSpender, type BudgetState, type Spend } from "./runtime/budget";
import { buildCrmAgentModel, type ModelChoice } from "./runtime/model";
import { reportResearch } from "./runtime/research";
import { loadAgentSession, type AgentSession } from "./runtime/session";
import { agentSkillSource } from "./runtime/skills";
import {
  closeExpiredSocket,
  SOCKET_LIFETIME_SECONDS,
} from "./runtime/socketLifetime";
import { MAX_OUTPUT_TOKENS, MAX_STEPS, prepareTurn } from "./runtime/turn";
import { parseSessionName } from "./sessionName";
import { normalizeTitle } from "./tools/conversation";

// A person's turn in a conversation gets this much research budget.
const CHAT_BUDGET = 4;

// Long tool-heavy conversations outgrow the Durable Object's memory before a
// model's window: compact between turns past this, and mid-turn as a step's
// input nears the proactive ceiling (OpenSEO's SAM numbers, scaled to the
// default model's 200k window).
const COMPACT_AFTER_TOKENS = 100_000;
const MAX_INPUT_TOKENS = 150_000;

const BUDGET_KEY = "crm-agent:budget";
const ROLE_KEY = "crm-agent:role";

const budgetSchema = z.object({
  spent: z.number(),
  budget: z.number(),
  exhausted: z.boolean(),
});

const INTERRUPTED_TURN_NOTICE =
  "That reply was cut off before it finished. Everything above is saved. Ask again, or tell me where to pick up.";

const GONE_REPLY =
  "This conversation no longer exists. Start a new one from the record.";

const TERMINAL_SUBMISSIONS = new Set([
  "completed",
  "aborted",
  "skipped",
  "error",
]);

/** The model the organization's workspace runs its agent on. */
async function modelFor(organizationId: string): Promise<ModelChoice> {
  const modelId = await AgentProfileRepository.agentModelId(organizationId);
  return { organizationId, modelId: modelId ?? DEFAULT_AGENT_MODEL.id };
}

/**
 * The research agent's Durable Object, on Think. One instance per research
 * session (a task the dispatcher started) or per person's conversation about
 * a record, named for it and its organization (sessionName.ts); everything it
 * reads and writes is that organization's. Think owns the loop (streaming,
 * persistence, recovery); this class contributes the model, the per-turn
 * prompt and tools, the research budget, the audit trail, and the report back
 * to the queue.
 */
export class CrmAgent extends Think {
  // The agent's tools are its own (tools/registry.ts); Think's workspace bash
  // and its just-bash dependency stay out (stubbed from the bundle).
  override workspaceBash = false;

  override maxSteps = MAX_STEPS;

  override contextOverflow = {
    proactive: { maxInputTokens: MAX_INPUT_TOKENS },
  };

  // The session and model, loaded at the start of each turn.
  private turnSession: AgentSession | null = null;
  private modelChoice: ModelChoice | null = null;

  getModel() {
    return buildCrmAgentModel(this.env, () => this.chooseModel());
  }

  override getSkills() {
    return [agentSkillSource()];
  }

  configureSession(session: Session): Session {
    return session
      .onCompaction(
        createCompactFunction({
          summarize: async (prompt) =>
            (await generateText({ model: this.getModel(), prompt })).text,
        }),
      )
      .compactAfter(COMPACT_AFTER_TOKENS);
  }

  /**
   * Starts this task's research turn (scheduled.ts). Accepted durably and
   * returned at once; the turn runs in this object and reports back when it
   * ends (onSubmissionStatus). A retried attempt continues the same thread.
   */
  async startResearch(input: {
    taskId: string;
    attempts: number;
    /** The lease the dispatcher holds: a task handed back is leased anew. */
    lease?: string | null;
  }): Promise<{ sessionId: string }> {
    const session = await withPgClient(() => loadAgentSession(this.name));
    if (session?.kind !== "research" || session.task.id !== input.taskId) {
      throw new Error("This research session has no task to work on.");
    }
    const key = `${input.taskId}:${input.attempts}:${input.lease ?? ""}`;
    await this.submitMessages(
      [
        {
          id: key,
          role: "user",
          parts: [
            { type: "text", text: researchBrief(session.task, input.attempts) },
          ],
        },
      ],
      { idempotencyKey: key },
    );
    return { sessionId: this.name };
  }

  async beforeTurn(turn: TurnContext): Promise<TurnConfig> {
    return withPgClient(async (): Promise<TurnConfig> => {
      const session = await loadAgentSession(this.name);
      this.turnSession = session;
      if (!session) {
        return { model: staticAssistantModel(GONE_REPLY), activeTools: [] };
      }
      this.modelChoice = await modelFor(session.organizationId);
      if (!turn.continuation) await this.openTurn(session);
      const install = await readCapabilities(this.env, session.organizationId);
      const { system, tools } = await prepareTurn(session, {
        thinkSystem: turn.system,
        capabilities: capabilityList(install),
        spend: this.spender(session),
        role: this.chatRole(),
      });
      return { system, tools, maxOutputTokens: MAX_OUTPUT_TOKENS };
    });
  }

  /** A new turn: a person's message (or the dispatcher's brief) arrived. */
  private async openTurn(session: AgentSession): Promise<void> {
    if (session.kind === "chat") {
      this.saveBudget({ spent: 0, budget: CHAT_BUDGET, exhausted: false });
      await AgentConversationRepository.recordMessage(
        session.organizationId,
        session.conversation.id,
        { messageCount: this.messages.length, assistant: false },
      );
    }
    await recordEvent(session, "turn.started", {
      by: session.kind === "chat" ? "person" : "dispatcher",
      message: lastText(this.messages, "user"),
    });
  }

  // A call outside a turn (a compaction summary) reads the choice itself.
  private async chooseModel(): Promise<ModelChoice | null> {
    if (this.modelChoice) return this.modelChoice;
    const name = parseSessionName(this.name);
    return name ? withPgClient(() => modelFor(name.organizationId)) : null;
  }

  /**
   * The session's research budget: a research task's, kept across its
   * attempts in this object's storage; a person's turn gets CHAT_BUDGET.
   */
  private spender(session: AgentSession): Spend {
    const stored = budgetSchema.safeParse(this.ctx.storage.kv.get(BUDGET_KEY));
    const state: BudgetState = stored.success
      ? stored.data
      : {
          spent: 0,
          budget: session.task?.budget ?? CHAT_BUDGET,
          exhausted: false,
        };
    return budgetSpender(state, (next) => this.saveBudget(next));
  }

  private saveBudget(state: BudgetState): void {
    this.ctx.storage.kv.put(BUDGET_KEY, { ...state });
  }

  /** The chat's person's gateway role, as their socket connected with it. */
  private chatRole(): string | null {
    const stored = z.string().safeParse(this.ctx.storage.kv.get(ROLE_KEY));
    return stored.success ? stored.data : null;
  }

  override async afterToolCall(call: ToolCallResultContext): Promise<void> {
    const session = this.turnSession;
    if (!session) return;
    await withPgClient(() =>
      recordEvent(session, call.success ? "tool.completed" : "tool.failed", {
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        input: call.input,
        durationMs: call.durationMs,
        ...(call.success
          ? { output: call.output }
          : { error: String(call.error) }),
      }),
    );
  }

  override async onStepFinish(step: StepContext): Promise<void> {
    const session = this.turnSession;
    if (!session) return;
    await withPgClient(() =>
      recordEvent(session, "step.completed", {
        stepNumber: step.stepNumber,
        finishReason: step.finishReason,
        inputTokens: step.usage.inputTokens ?? null,
        outputTokens: step.usage.outputTokens ?? null,
        costUsd: openRouterCostUsd(step.providerMetadata),
      }),
    );
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    const session = this.turnSession;
    if (!session) return;
    await withPgClient(async () => {
      await recordEvent(session, "message.completed", {
        status: result.status,
        text: messageText(result.message),
        ...(result.error ? { error: result.error } : {}),
      });
      if (session.kind !== "chat") return;
      await AgentConversationRepository.recordMessage(
        session.organizationId,
        session.conversation.id,
        {
          messageCount: this.messages.length,
          assistant: result.status === "completed",
        },
      );
      // Named from the first message when the model didn't name it.
      const title = normalizeTitle(lastText(this.messages.slice(0, 1), "user"));
      if (!session.conversation.title && title) {
        await AgentConversationRepository.setTitleIfEmpty(
          session.organizationId,
          session.conversation.id,
          title,
        );
      }
    });
  }

  // The return value becomes the stored chat-terminal body that reconnecting
  // clients replay.
  override onChatError(error: unknown, context?: ChatErrorContext): unknown {
    console.error(
      "[agent] turn failed",
      { name: this.name, stage: context?.stage },
      error,
    );
    const session = this.turnSession;
    if (session) {
      this.ctx.waitUntil(
        withPgClient(() =>
          recordEvent(session, "turn.failed", {
            stage: context?.stage ?? null,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }
    return error;
  }

  /** A research turn ended: finish its task, or fail it for a retry. */
  override async onSubmissionStatus(
    submission: ThinkSubmissionInspection,
  ): Promise<void> {
    if (!TERMINAL_SUBMISSIONS.has(submission.status)) return;
    await withPgClient(async () => {
      const session = await loadAgentSession(this.name);
      if (session?.kind !== "research") return;
      if (submission.status === "completed") {
        await reportResearch(session, {
          status: "completed",
          text: finalText(this.messages),
        });
      } else if (submission.status === "error") {
        await reportResearch(session, {
          status: "error",
          error: submission.error ?? "The agent turn failed.",
        });
      } else {
        await reportResearch(session, { status: "aborted" });
      }
    });
  }

  // Each chat socket closes SOCKET_LIFETIME_SECONDS after it connects and the
  // client reconnects through the gateway (runtime/socketLifetime.ts). The
  // close is an alarm, so it outlives hibernation.
  override async onConnect(...args: Parameters<Think["onConnect"]>) {
    // The role the Worker verified for the person connecting (agentRoutes.ts).
    // A conversation is one person's, so the last connect's role is theirs,
    // at most one socket lifetime old.
    const role = args[1].request.headers.get(CHAT_ROLE_HEADER);
    if (role) this.ctx.storage.kv.put(ROLE_KEY, role);
    else this.ctx.storage.kv.delete(ROLE_KEY);
    await super.onConnect(...args);
    await this.schedule(SOCKET_LIFETIME_SECONDS, "closeSocket", args[0].id);
  }

  closeSocket(connectionId: string): void {
    closeExpiredSocket(this.getConnection(connectionId));
  }

  // An interrupted turn is never re-run automatically (OpenSEO SAM's lesson:
  // a turn killed by the memory limit dies the same way on every re-run, each
  // a full model call). The partial reply is kept; a research task is tried
  // again by the dispatcher once its lease runs out, and a person is told.
  override async onChatRecovery(
    context: ChatRecoveryContext,
  ): Promise<ChatRecoveryOptions> {
    console.warn("[agent] interrupted turn not re-run", {
      name: this.name,
      incidentId: context.incidentId,
    });
    if (parseSessionName(this.name)?.kind === "chat") {
      await this.schedule(1, "notifyInterruptedTurn", context.incidentId, {
        idempotent: true,
      });
    }
    return { persist: true, continue: false };
  }

  async notifyInterruptedTurn(): Promise<void> {
    await this.deliverNotice(INTERRUPTED_TURN_NOTICE);
  }
}
