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
 * turn succeeds, fails or is cancelled, once (AgentRunService).
 */
export async function endSubmission(
  sessionId: string,
  submission: ThinkSubmissionInspection,
  messages: UIMessage[],
): Promise<void> {
  if (!TERMINAL_SUBMISSIONS.has(submission.status)) return;
  const session = await loadAgentSession(sessionId);
  if (session?.kind === "run") {
    await RunSettlement.endTurn(
      session.organizationId,
      session.run.id,
      submission,
    );
    return;
  }
  if (session?.kind !== "research") return;
  if (submission.status === "completed") {
    await reportResearch(session, {
      status: "completed",
      text: finalText(messages),
    });
  } else if (submission.status === "error") {
    await reportResearch(session, {
      status: "error",
      error: submission.error ?? "The agent turn failed.",
    });
  } else {
    await reportResearch(session, { status: "aborted" });
  }
}
