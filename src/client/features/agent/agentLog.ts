import { z } from "zod";
import { describeStep, type Step } from "./agentSteps";

// The record's log of what the agent did, from its audit trail (agent_event):
// one run per session (a research task the dispatcher started, or one of the
// person's conversations), newest run first, its steps in the order taken.
// Model bookkeeping (steps' token counts, the turn's own messages) stays out;
// tool calls, and how the run ended, go in.

type AgentEvent = {
  id: string;
  sessionId: string;
  conversationId: string | null;
  type: string;
  data: unknown;
  emittedAt: string;
};

export type LogEntry = Step & { id: string; at: string; detail: string | null };

export type Run = {
  sessionId: string;
  /** The person's conversation the run was, or null for research. */
  conversationId: string | null;
  /** When it last did something. */
  at: string;
  entries: LogEntry[];
};

const toolEventSchema = z.object({
  toolName: z.string(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

const words = z.string().trim().min(1).nullable().catch(null);
const endingSchema = z
  .object({ outcome: words, reason: words, message: words })
  .catch({ outcome: null, reason: null, message: null });

function entryOf(event: AgentEvent): LogEntry | null {
  const base = { id: event.id, at: event.emittedAt, sources: [] };
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    const tool = toolEventSchema.safeParse(event.data);
    if (!tool.success) return null;
    const failed = event.type === "tool.failed";
    return {
      ...base,
      ...describeStep(tool.data.toolName, {
        output: failed ? { error: tool.data.error } : tool.data.output,
        failed,
      }),
      detail: null,
    };
  }
  const ending = endingSchema.parse(event.data);
  if (event.type === "task.finished") {
    return {
      ...base,
      label: "Finished",
      tone: "success",
      detail: ending.outcome,
    };
  }
  if (event.type === "task.failed") {
    return {
      ...base,
      label: "Could not finish",
      tone: "warning",
      detail: ending.reason,
    };
  }
  if (event.type === "turn.failed") {
    return {
      ...base,
      label: "Stopped by an error",
      tone: "warning",
      detail: ending.message,
    };
  }
  return null;
}

/** Groups the record's events, newest first, into runs. */
export function agentRuns(events: readonly AgentEvent[]): Run[] {
  const runs = new Map<string, Run>();
  for (const event of events) {
    const entry = entryOf(event);
    if (!entry) continue;
    const run = runs.get(event.sessionId) ?? {
      sessionId: event.sessionId,
      conversationId: event.conversationId,
      at: event.emittedAt,
      entries: [],
    };
    // Events arrive newest first; a run reads in the order it happened.
    run.entries.unshift(entry);
    runs.set(event.sessionId, run);
  }
  return [...runs.values()];
}
