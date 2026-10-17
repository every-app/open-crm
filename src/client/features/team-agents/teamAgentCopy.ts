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

/** A change that waits for review was saved as a new version. */
export const REVIEW_SAVED = "Saved. Review and deploy the new version.";

export const TRIGGER_COPY: Record<TriggerType, string> = {
  MANUAL: "Manual",
  SCHEDULE: "Schedule",
  EVENT: "Event",
};

/** Suggested agents, as the CRM's builder home offers them. */
export const BUILDER_SUGGESTIONS = [
  "Brief every deal owner before a renewal call",
  "Flag deals with no activity for 14 days",
  "Hand new customers from Sales to Onboarding",
];

export const CREATE_AGENT_PREFIX = "/Create agent ";
