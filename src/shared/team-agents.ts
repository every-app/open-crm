import { z } from "zod";
import type { SyncSource } from "./mailbox";

// Team agents, ported from the CRM's agent builder and runner: a team
// describes an agent in a private builder chat, reviews the version the
// builder saved, deploys it, and the agent runs on a schedule, on CRM events
// or by hand. This module is the shared contract: the statuses, the CRM event
// vocabulary, the action types and the version manifest the builder writes,
// the server enforces and the client shows.

export const TEAM_AGENT_STATUSES = [
  "DRAFT",
  "LIVE",
  "PAUSED",
  "ARCHIVED",
  "DELETED",
] as const;
export type TeamAgentStatus = (typeof TEAM_AGENT_STATUSES)[number];

/** Statuses the whole team sees; a DRAFT is its creator's alone. */
export const TEAM_VISIBLE_STATUSES = ["LIVE", "PAUSED", "ARCHIVED"] as const;

export const AGENT_VERSION_STATUSES = ["READY", "DEPLOYED"] as const;

export const ARTIFACT_STATUSES = ["WRITING", "READY"] as const;

export const TRIGGER_TYPES = ["MANUAL", "SCHEDULE", "EVENT"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** A run that has not ended: it can be stopped, and blocks another. */
export const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;

export const ACTION_STATUSES = [
  "PLANNED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export const FEEDBACK_RATINGS = ["UP", "DOWN"] as const;

/** How often a schedule may recur, as in the CRM: every minute to once a year. */
export const AGENT_TRIGGER_INTERVAL_MINUTES = {
  min: 1,
  max: 525_600,
} as const;

// The CRM events an EVENT trigger can listen for, as the CRM's crm-events.ts.
export const CRM_EVENT_TYPES = [
  "company.created",
  "contact.created",
  "deal.created",
  "deal.stage.changed",
  "deal.opened",
  "deal.closed",
] as const;

export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

export const CRM_EVENT_CATALOG = {
  "company.created": {
    label: "Company created",
    description: "A company is added to the CRM",
    recordKind: "company",
  },
  "contact.created": {
    label: "Contact created",
    description: "A contact is added to the CRM",
    recordKind: "contact",
  },
  "deal.created": {
    label: "Deal created",
    description: "A deal is added to the CRM",
    recordKind: "deal",
  },
  "deal.stage.changed": {
    label: "Deal stage changed",
    description: "A deal moves from one pipeline stage to another",
    recordKind: "deal",
  },
  "deal.opened": {
    label: "Deal opened",
    description: "A closed deal returns to the open pipeline",
    recordKind: "deal",
  },
  "deal.closed": {
    label: "Deal closed",
    description: "An open deal moves to a closed stage",
    recordKind: "deal",
  },
} as const satisfies Record<
  CrmEventType,
  {
    label: string;
    description: string;
    recordKind: "company" | "contact" | "deal";
  }
>;

export const AGENT_ACTION_TYPES = {
  CRM_ACTIVITY_CREATE: "crm.activity.create",
  RUN_SUMMARY: "run.summary",
  SLACK_MESSAGE_POST: "slack.message.post",
} as const;

export const ACTION_LABELS: Record<string, string> = {
  [AGENT_ACTION_TYPES.SLACK_MESSAGE_POST]: "Post a message",
  [AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE]: "Write a note or task on a record",
  [AGENT_ACTION_TYPES.RUN_SUMMARY]: "Write a summary of the run",
};

/** The integration a version names to be allowed to post to Slack. */
export const SLACK_RESOURCE = {
  kind: "integration",
  id: "slack:workspace",
  label: "Slack",
} as const;

/** The attachments that open in place, and show as thumbnails. */
export const PREVIEWABLE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SLACK_CHANNEL_PREFIX = "slack:channel:";

/** The id a Slack channel is tagged by in a builder chat. */
export const slackChannelResourceId = (channelId: string) =>
  `${SLACK_CHANNEL_PREFIX}${channelId}`;

/** The Slack channel a builder chat's tag names, or null. */
export const taggedSlackChannel = (resourceId: string) =>
  resourceId.startsWith(SLACK_CHANNEL_PREFIX)
    ? resourceId.slice(SLACK_CHANNEL_PREFIX.length)
    : null;

/**
 * The captured mail and meetings a version may read (the CRM's
 * `google:gmail` and `google:calendar` integrations). Capture is per member
 * but filed on shared records, so the grant is to what the organization
 * captured, Gmail and Outlook alike, on the records the version may see;
 * never to anyone's mailbox. Each is available once any member has
 * connected one of its sources (Settings → Connections).
 */
export const CAPTURE_GRANTS = {
  email: {
    resource: { kind: "integration", id: "capture:email", label: "Email" },
    access: "Read captured email on the records it can see",
    sources: ["gmail", "outlook"],
  },
  calendar: {
    resource: {
      kind: "integration",
      id: "capture:calendar",
      label: "Calendar",
    },
    access: "Read captured meetings on the records it can see",
    sources: ["calendar"],
  },
} as const satisfies Record<
  string,
  {
    resource: { kind: "integration"; id: string; label: string };
    access: string;
    sources: readonly SyncSource[];
  }
>;

export const CAPTURE_KINDS = ["email", "calendar"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];
export type CaptureGrants = Record<CaptureKind, boolean>;

/** Which captured sources `resources` (a manifest's scope) grants. */
export function captureGrants(
  resources: readonly { kind: string; id: string }[],
): CaptureGrants {
  const ids = new Set(
    resources
      .filter((resource) => resource.kind === "integration")
      .map((resource) => resource.id),
  );
  return {
    email: ids.has(CAPTURE_GRANTS.email.resource.id),
    calendar: ids.has(CAPTURE_GRANTS.calendar.resource.id),
  };
}

const recordResource = z.object({
  kind: z.enum(["company", "contact", "deal"]),
  id: z.string().min(1),
  label: z.string().min(1),
});

const manifestResource = z.object({
  kind: z.enum(["company", "contact", "deal", "integration"]),
  id: z.string().min(1),
  label: z.string().min(1),
});

export type ManifestResource = z.infer<typeof manifestResource>;
export type RecordResource = z.infer<typeof recordResource>;

const slackDestination = z.object({
  kind: z.enum(["channel", "user"]),
  resolution: z.literal("chosen"),
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
});

const manifestAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE),
    provider: z.literal("crm"),
    summary: z.string(),
    activityTypes: z
      .array(z.enum(["NOTE", "TASK"]))
      .min(1)
      .max(2),
  }),
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.RUN_SUMMARY),
    provider: z.literal("crm"),
    summary: z.string(),
  }),
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.SLACK_MESSAGE_POST),
    provider: z.literal("slack"),
    summary: z.string(),
    destination: slackDestination,
  }),
]);

export type SlackDestination = z.infer<typeof slackDestination>;

const manifestTrigger = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MANUAL"),
    name: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("SCHEDULE"),
    name: z.string(),
    summary: z.string(),
    intervalMinutes: z.number().int().min(AGENT_TRIGGER_INTERVAL_MINUTES.min),
    nextRunAt: z.string(),
  }),
  z.object({
    type: z.literal("EVENT"),
    name: z.string(),
    summary: z.string(),
    event: z.enum(CRM_EVENT_TYPES),
  }),
]);

/**
 * A version's manifest: what it may read, what it may do and when it runs.
 * The runtime enforces it on every tool call; the review screen shows it.
 */
export const agentManifest = z
  .object({
    name: z.string(),
    description: z.string(),
    triggers: z.array(manifestTrigger).min(1),
    dataScope: z.object({
      mode: z.enum(["SELECTED", "WORKSPACE"]),
      summary: z.string(),
      resources: z.array(manifestResource),
    }),
    actions: z.array(manifestAction).min(1),
    access: z.array(z.string()),
  })
  .superRefine((manifest, context) => {
    const types = new Set<string>();
    for (const [index, action] of manifest.actions.entries()) {
      if (types.has(action.type)) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "type"],
          message: `Duplicate ${action.type} action`,
        });
      }
      types.add(action.type);
    }
  });

export type AgentManifest = z.infer<typeof agentManifest>;

/** The records (not integrations) a manifest's scope names. */
export function recordResources(
  resources: readonly ManifestResource[],
): RecordResource[] {
  return resources.flatMap((resource) =>
    resource.kind === "integration"
      ? []
      : [{ ...resource, kind: resource.kind }],
  );
}

/** The one Slack destination a manifest approves, if it posts to Slack. */
export function slackDestinationOf(
  manifest: AgentManifest,
): SlackDestination | null {
  for (const action of manifest.actions) {
    if (action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST) {
      return action.destination;
    }
  }
  return null;
}
