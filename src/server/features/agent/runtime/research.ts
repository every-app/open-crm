import { settle } from "../dispatch/enrichment";
import {
  AgentTaskRepository,
  type TaskSubject,
} from "../repositories/AgentTaskRepository";
import { AgentAvailabilityService } from "../services/AgentAvailabilityService";
import { recordEvent } from "./audit";
import type { ResearchSession } from "./session";

// How a research session reports back to the queue when its turn ends, ported
// from the CRM's crm channel (session.completed, turn.failed,
// turn.cancelled): a turn that ran finishes the task and completes the
// record; a turn that failed fails the record and leaves the task open, so
// the dispatcher tries again once its lease runs out (and retires it after
// MAX_ATTEMPTS). A turn the gateway refused a model for never ran: its task
// goes back to wait, its attempt uncounted, until the model is set up.

type TurnEnding =
  | { status: "completed"; text: string }
  | { status: "aborted" | "skipped" }
  | { status: "error"; error: string };

/** The gateway (or, in dev, .dev.vars) has no model key: retrying won't help. */
export function modelUnavailable(error: string): boolean {
  return /Provider is not configured|AI gateway unavailable|OPENROUTER_API_KEY/i.test(
    error,
  );
}

function subjectOf(session: ResearchSession): TaskSubject {
  return {
    id: session.task.id,
    organizationId: session.organizationId,
    kind: session.task.kind,
    ...session.record,
  };
}

export async function reportResearch(
  session: ResearchSession,
  ending: TurnEnding,
): Promise<void> {
  const { organizationId, task, sessionId } = session;
  if (ending.status === "completed") {
    const outcome = ending.text || "Ran.";
    const subject = await AgentTaskRepository.complete(
      organizationId,
      task.id,
      outcome,
      sessionId,
    );
    if (subject) await settle(subject, "COMPLETE");
    await recordEvent(session, "task.finished", {
      taskId: task.id,
      kind: task.kind,
      outcome,
    });
    return;
  }
  if (ending.status !== "error") {
    const subject = await AgentTaskRepository.complete(
      organizationId,
      task.id,
      "Stopped before it finished.",
      sessionId,
    );
    if (subject) await settle(subject, "SKIPPED");
    return;
  }
  if (modelUnavailable(ending.error)) {
    await AgentAvailabilityService.noteRefusal(organizationId, ending.error);
    const subject = await AgentTaskRepository.release(organizationId, task.id);
    if (subject) await settle(subject, "PENDING");
    return;
  }
  await settle(subjectOf(session), "FAILED", ending.error);
  await recordEvent(session, "task.failed", {
    taskId: task.id,
    reason: ending.error,
  });
}
