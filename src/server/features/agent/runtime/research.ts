import { MAX_ATTEMPTS } from "@/shared/agent-tasks";
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
// MAX_ATTEMPTS). Two failures aren't the work's, so they use no attempt and
// the task goes back to wait: the gateway refused a model (until the model is
// set up), or the model's provider failed (an outage, tried again later and
// later, for a day).

const MINUTE_MS = 60_000;

/** Between tries after a provider failure: the time since the task started, within these. */
const UPSTREAM_RETRY = {
  minMs: 5 * MINUTE_MS,
  maxMs: 2 * 60 * MINUTE_MS,
  // After this long since the task started, a provider failure counts.
  forMs: 24 * 60 * MINUTE_MS,
} as const;

type TurnEnding =
  | { status: "completed"; text: string }
  | { status: "aborted" | "skipped" }
  | { status: "error"; error: string };

/** The gateway (or, in dev, .dev.vars) has no model key: retrying won't help. */
export function modelUnavailable(error: string): boolean {
  return /Provider is not configured|default model provider|AI gateway unavailable|OPENROUTER_API_KEY|ai_default_not_configured|ai_provider_not_configured/i.test(
    error,
  );
}

/**
 * The model's provider failed, not the work: the gateway's
 * `ai_upstream_failed`, a server error or rate limit the SDK's own retries
 * ran out on ("Failed after 3 attempts. Last error: ..."), or a timeout.
 */
function upstreamFailure(error: string): boolean {
  return /ai_upstream_failed|Upstream provider request failed|^Failed after \d+ attempts\. Last error|Provider returned error|Bad Gateway|Service Unavailable|Gateway Timeout|timed out|timeout/i.test(
    error,
  );
}

/**
 * When a task its model's provider failed is tried again: after as long as
 * it has been going (so the waits grow), or null once it has been going a
 * day, when the failure counts as any other.
 */
function upstreamRetryAt(startedAt: string | null, now: number): string | null {
  const going = startedAt ? now - Date.parse(startedAt) : 0;
  if (going > UPSTREAM_RETRY.forMs) return null;
  const waitMs = Math.min(
    UPSTREAM_RETRY.maxMs,
    Math.max(UPSTREAM_RETRY.minMs, going),
  );
  return new Date(now + waitMs).toISOString();
}

function subjectOf(session: ResearchSession): TaskSubject {
  return {
    id: session.task.id,
    organizationId: session.organizationId,
    kind: session.task.kind,
    ...session.record,
  };
}

/**
 * Reports the turn's ending to the queue. True when the task is done with
 * this session for good: it finished, or failed its last attempt.
 */
export async function reportResearch(
  session: ResearchSession,
  ending: TurnEnding,
): Promise<boolean> {
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
    return true;
  }
  if (ending.status !== "error") {
    const subject = await AgentTaskRepository.complete(
      organizationId,
      task.id,
      "Stopped before it finished.",
      sessionId,
    );
    if (subject) await settle(subject, "SKIPPED");
    return true;
  }
  if (modelUnavailable(ending.error)) {
    await AgentAvailabilityService.noteRefusal(organizationId, ending.error);
    const subject = await AgentTaskRepository.release(organizationId, task.id);
    if (subject) await settle(subject, "PENDING");
    return false;
  }
  if (upstreamFailure(ending.error)) {
    const started = await AgentTaskRepository.findById(organizationId, task.id);
    const retryAt = upstreamRetryAt(started?.startedAt ?? null, Date.now());
    if (retryAt) {
      console.warn("[agent] the model's provider failed; trying again later", {
        taskId: task.id,
        retryAt,
      });
      const subject = await AgentTaskRepository.release(
        organizationId,
        task.id,
        retryAt,
      );
      if (subject) await settle(subject, "PENDING");
      return false;
    }
  }
  await settle(subjectOf(session), "FAILED", ending.error);
  await recordEvent(session, "task.failed", {
    taskId: task.id,
    reason: ending.error,
  });
  return task.attempts >= MAX_ATTEMPTS;
}
