import type {
  RunStatus,
  TeamAgentStatus,
  TriggerType,
} from "@/shared/team-agents";

type Tone =
  | "success"
  | "warning"
  | "secondary"
  | "outline"
  | "destructive"
  | "info";

export const STATUS_COPY: Record<
  TeamAgentStatus,
  { label: string; tone: Tone }
> = {
  DRAFT: { label: "Private draft", tone: "outline" },
  LIVE: { label: "Live", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  ARCHIVED: { label: "Archived", tone: "secondary" },
  DELETED: { label: "Deleted", tone: "secondary" },
};

export const RUN_STATUS_COPY: Record<RunStatus, { label: string; tone: Tone }> =
  {
    QUEUED: { label: "Queued", tone: "outline" },
    RUNNING: { label: "Running", tone: "info" },
    SUCCEEDED: { label: "Succeeded", tone: "success" },
    FAILED: { label: "Failed", tone: "destructive" },
    CANCELLED: { label: "Cancelled", tone: "secondary" },
  };

export const TRIGGER_COPY: Record<TriggerType, string> = {
  MANUAL: "Manual",
  SCHEDULE: "Schedule",
  EVENT: "Event",
};

/** What a failed run's code means, as the CRM's agent-run-failure.ts says it. */
const RUN_FAILURES: Record<string, string> = {
  ACTION_NOT_PERFORMED:
    "The agent finished without doing what it was built to do.",
  DEPENDENCY_UNAVAILABLE:
    "A connection this agent needs is missing. Reconnect it, then run again.",
  NOT_AUTHORISED:
    "The connection refused this. Its access may have been revoked or narrowed.",
  PROVIDER_ERROR: "The outside service rejected this. Try again.",
  TURN_FAILED: "The model failed part-way through this run.",
  DELIVERY_FAILED: "The run never reached the agent.",
  ACTION_REJECTED: "The CRM refused the agent's action. Nothing was written.",
  AGENT_UNAVAILABLE: "The agent was paused or archived when this run started.",
  AGENT_DELETED: "The agent was deleted before this run finished.",
  CANCELLED: "Someone stopped this run.",
  RUN_TIMED_OUT: "This run took too long and was stopped.",
};

/** Why a run failed, in plain words, else what it reported. */
export function runFailureReason(
  code: string | null,
  message: string | null,
): string {
  return (
    (code ? RUN_FAILURES[code] : undefined) ??
    (message?.trim() || "No reason given.")
  );
}
