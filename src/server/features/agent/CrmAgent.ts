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
import { SessionMeter } from "@/server/billing/meter";
import { OUT_OF_CREDITS_REPLY } from "@/shared/billing";
import {
  openRouterCostUsd,
  staticAssistantModel,
} from "@/server/lib/chatAgent";
import { AgentRunRepository } from "@/server/features/team-agents/repositories/AgentRunRepository";
import { checkedSocketMessage } from "@/server/features/team-agents/runtime/answers";
import {
  prepareBuilderTurn,
  prepareRunTurn,
  RUN_LIMITS,
  RUN_STOPPED_REPLY,
  runBrief,
  withinRunInput,
} from "@/server/features/team-agents/runtime/turns";
import { CHAT_ROLE_HEADER } from "./agentRoutes";
import { capabilityList, readCapabilities } from "./prompt/capabilities";
import { AgentConversationRepository } from "./repositories/AgentConversationRepository";
import { lastText, messageText, recordEvent } from "./runtime/audit";
import { researchBrief } from "./runtime/brief";
import { budgetSpender, type BudgetState, type Spend } from "./runtime/budget";
import {
  buildCrmAgentModel,
  effortFor,
  type ModelChoice,
} from "./runtime/model";
import {
  loadAgentSession,
  type AgentSession,
  type ChatSession,
} from "./runtime/session";
import { agentSkillSource } from "./runtime/skills";
import { endSubmission } from "./runtime/submission";
import {
  closeExpiredSocket,
  SOCKET_LIFETIME_SECONDS,
} from "./runtime/socketLifetime";
import { MAX_STEPS, maxOutputTokens, prepareTurn } from "./runtime/turn";
import { parseSessionName } from "./sessionName";
import { normalizeTitle } from "./tools/conversation";

// A person's turn in a conversation gets this much research budget.
const CHAT_BUDGET = 4;

// Long tool-heavy conversations outgrow the Durable Object's memory before
// the model's window: compact between turns past this, and mid-turn as a
// step's input nears the proactive ceiling (OpenSEO's SAM numbers for Luna).
const COMPACT_AFTER_TOKENS = 120_000;
const MAX_INPUT_TOKENS = 160_000;

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

  // Hosted billing: what the session spends (server/billing/meter.ts).
  private readonly meter = new SessionMeter((p) => this.ctx.waitUntil(p));

  constructor(...args: ConstructorParameters<typeof Think>) {
    super(...args);
    // An answer to the agent's open question is checked before Think takes
    // it (team-agents/runtime/answers.ts).
    const onMessage = this.onMessage.bind(this);
    this.onMessage = async (connection, message) => {
      const checked = checkedSocketMessage(message, this.messages);
      if (checked !== null) await onMessage(connection, checked);
    };
  }

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
          // At "low", whoever's turn the summary interrupts.
          summarize: async (prompt) => {
            const model = buildCrmAgentModel(
              this.env,
              () => this.chooseModel(),
              "low",
            );
            const result = await generateText({ model, prompt });
            this.meter.record(openRouterCostUsd(result.providerMetadata));
            return result.text;
          },
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

  /**
   * Starts a team agent's run (team-agents/runtime/dispatch.ts): accepted
   * durably and returned at once; the run settles when its turn ends
   * (onSubmissionStatus). The run id is the submission id, so stopRun can
   * cancel it.
   */
  async startRun(input: { runId: string }): Promise<{ sessionId: string }> {
    const session = await withPgClient(() => loadAgentSession(this.name));
    if (session?.kind !== "run" || session.run.id !== input.runId) {
      throw new Error("This run session has no run to work on.");
    }
    await this.submitMessages(
      [
        {
          id: input.runId,
          role: "user",
          parts: [{ type: "text", text: runBrief(input.runId) }],
        },
      ],
      { submissionId: input.runId, idempotencyKey: input.runId },
    );
    return { sessionId: this.name };
  }

  /**
   * Stops a run's turn so it spends nothing more. The run's row already says
   * it was stopped, which is what keeps its tools from acting.
   */
  async stopRun(input: { runId: string }): Promise<void> {
    await this.cancelSubmission(input.runId, "The run was stopped.");
  }

  async beforeTurn(turn: TurnContext): Promise<TurnConfig> {
    return withPgClient(async (): Promise<TurnConfig> => {
      const session = await loadAgentSession(this.name);
      this.turnSession = session;
      if (!session) {
        return { model: staticAssistantModel(GONE_REPLY), activeTools: [] };
      }
      this.modelChoice = {
        organizationId: session.organizationId,
        effort: effortFor(session.kind),
      };
      if (await this.meter.admit(session)) {
        return {
          model: staticAssistantModel(OUT_OF_CREDITS_REPLY),
          activeTools: [],
        };
      }
      if (session.kind === "run") {
        const prepared = await prepareRunTurn(session, {
          thinkSystem: turn.system,
          spend: this.spender(session),
          sink: this.meter.sink,
        });
        if (!prepared) {
          return {
            model: staticAssistantModel(RUN_STOPPED_REPLY),
            activeTools: [],
          };
        }
        if (!turn.continuation) await this.openTurn(session);
        return {
          system: prepared.system,
          tools: prepared.tools,
          maxSteps: RUN_LIMITS.maxSteps,
          maxOutputTokens: RUN_LIMITS.maxOutputTokens,
          stopWhen: withinRunInput,
        };
      }
      if (!turn.continuation) await this.openTurn(session);
      else if (session.kind === "chat") await this.continueTurn(session);
      if (session.kind === "chat" && session.conversation.kind === "BUILDER") {
        const { system, tools, messages } = prepareBuilderTurn(session, {
          thinkSystem: turn.system,
          messages: this.messages,
          spend: this.spender(session),
          sink: this.meter.sink,
        });
        return {
          system,
          tools,
          // What the person tagged and attached (team-agents/runtime/turns.ts).
          messages: await messages(turn.messages),
          maxOutputTokens: maxOutputTokens("chat"),
        };
      }
      const install = await readCapabilities(this.env, session.organizationId);
      const { system, tools } = await prepareTurn(session, {
        thinkSystem: turn.system,
        capabilities: capabilityList(install),
        spend: this.spender(session),
        role: this.chatRole(),
        sink: this.meter.sink,
      });
      return { system, tools, maxOutputTokens: maxOutputTokens(session.kind) };
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

  /**
   * A person's answer (to a question, or an approval) resumed the turn: the
   * conversation moved, as its list shows, and a chat that moved lately is
   * asked whether it is still answering (BuilderService.listConversations).
   */
  private async continueTurn(session: ChatSession): Promise<void> {
    await AgentConversationRepository.recordMessage(
      session.organizationId,
      session.conversation.id,
      { messageCount: this.messages.length, assistant: false },
    );
  }

  /**
   * Whether a turn is answering in this session now: its reply is streaming.
   * Read from Think's own stream state, which outlives a restart, for the
   * chat list's working spinner.
   */
  async isAnswering(): Promise<boolean> {
    return this._resumableStream.hasActiveStream();
  }

  // A call outside a turn (a compaction summary) is background work.
  private async chooseModel(): Promise<ModelChoice | null> {
    if (this.modelChoice) return this.modelChoice;
    const name = parseSessionName(this.name);
    return name ? { organizationId: name.organizationId, effort: "low" } : null;
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
          budget:
            session.kind === "run"
              ? RUN_LIMITS.budget
              : (session.task?.budget ?? CHAT_BUDGET),
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
    const costUsd = openRouterCostUsd(step.providerMetadata);
    this.meter.record(costUsd);
    const session = this.turnSession;
    if (!session) return;
    await withPgClient(async () => {
      await recordEvent(session, "step.completed", {
        stepNumber: step.stepNumber,
        finishReason: step.finishReason,
        inputTokens: step.usage.inputTokens ?? null,
        outputTokens: step.usage.outputTokens ?? null,
        costUsd,
      });
      // A run carries its own tokens and cost, for the runs drawer.
      if (session.kind === "run") {
        await AgentRunRepository.addUsage(
          session.organizationId,
          session.run.id,
          {
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
            costUsd: costUsd ?? 0,
          },
        );
      }
    });
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    this.meter.flush();
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
    // A stopped or failed turn still consumed what it consumed.
    this.meter.flush();
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

  override async onSubmissionStatus(
    submission: ThinkSubmissionInspection,
  ): Promise<void> {
    await withPgClient(() =>
      endSubmission(this.name, submission, this.messages),
    );
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
