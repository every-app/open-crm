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

/** Suggested agents, as the CRM's builder home offers them. */
export const BUILDER_SUGGESTIONS = [
  "Every Monday, post the deals that slipped to Slack",
  "Flag deals with no activity for 14 days",
  "When a deal closes, write a note with what won it",
];

export const CREATE_AGENT_PREFIX = "/Create agent ";
