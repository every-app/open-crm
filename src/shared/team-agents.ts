import { z } from "zod";

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

/**
 * What bounds a team agent's spending (docs/maintainers/agent.md, "Team
 * agents"): runs are model calls the gateway's keys pay for.
 */
export const TEAM_AGENT_LIMITS = {
  /** The shortest schedule; with the daily cap, at most two runs an hour. */
  minScheduleMinutes: 30,
  maxScheduleMinutes: 525_600,
  /** Runs one agent may start in any 24 hours, however they are triggered. */
  maxRunsPerDay: 50,
} as const;

// The CRM events an EVENT trigger can listen for, as the CRM's crm-events.ts.
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
  string,
  {
    label: string;
    description: string;
    recordKind: "company" | "contact" | "deal";
  }
>;

export type CrmEventType = keyof typeof CRM_EVENT_CATALOG;

export const CRM_EVENT_TYPES = Object.keys(CRM_EVENT_CATALOG) as [
  CrmEventType,
  ...CrmEventType[],
];

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

export const manifestAction = z.discriminatedUnion("type", [
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

export type ManifestAction = z.infer<typeof manifestAction>;
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
    intervalMinutes: z.number().int().min(1),
    nextRunAt: z.string(),
  }),
  z.object({
    type: z.literal("EVENT"),
    name: z.string(),
    summary: z.string(),
    event: z.enum(CRM_EVENT_TYPES),
  }),
]);

export type ManifestTrigger = z.infer<typeof manifestTrigger>;

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
    resource.kind === "integration" ? [] : [{ ...resource, kind: resource.kind }],
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
