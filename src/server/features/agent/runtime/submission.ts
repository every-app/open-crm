import type { ThinkSubmissionInspection } from "@cloudflare/think";
import type { UIMessage } from "ai";
import { RunSettlement } from "@/server/features/team-agents/services/RunSettlement";
import { finalText } from "./audit";
import { reportResearch } from "./research";
import { loadAgentSession } from "./session";

const TERMINAL_SUBMISSIONS = new Set([
  "completed",
  "aborted",
  "skipped",
  "error",
]);

/**
 * A submitted turn changed status (CrmAgent.onSubmissionStatus). When it has
 * ended: a research turn finishes its task, or fails it for a retry; a run's
 * turn succeeds, fails or is cancelled, once (AgentRunService). True when
 * the session has reported back for good: a run, or a research task that
 * won't be tried again in it.
 */
export async function endSubmission(
  sessionId: string,
  submission: ThinkSubmissionInspection,
  messages: UIMessage[],
): Promise<boolean> {
  if (!TERMINAL_SUBMISSIONS.has(submission.status)) return false;
  const session = await loadAgentSession(sessionId);
  if (session?.kind === "run") {
    await RunSettlement.endTurn(
      session.organizationId,
      session.run.id,
      submission,
    );
    return true;
  }
  if (session?.kind !== "research") return false;
  if (submission.status === "completed") {
    return reportResearch(session, {
      status: "completed",
      text: finalText(messages),
    });
  }
  if (submission.status === "error") {
    return reportResearch(session, {
      status: "error",
      error: submission.error ?? "The agent turn failed.",
    });
  }
  return reportResearch(session, { status: "aborted" });
}
