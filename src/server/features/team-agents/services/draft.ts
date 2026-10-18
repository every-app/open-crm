import { z } from "zod";
import {
  AGENT_ACTION_TYPES,
  AGENT_TRIGGER_INTERVAL_MINUTES,
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  CRM_EVENT_CATALOG,
  CRM_EVENT_TYPES,
  SLACK_RESOURCE,
  type AgentManifest,
  type CaptureGrants,
  type ManifestResource,
} from "@/shared/team-agents";
import type { DescribedRecord } from "../repositories/BuilderRepository";

// What the builder's save_agent_draft takes and how a draft is checked before
// it becomes a version, ported from the CRM's draft-input.ts and
// builder-runtime.ts (validateDraft). The checks are the version's
// permissions: a selected scope names only records tagged in the chat, by
// their exact labels; a Slack destination is one the inventory holds; every
// executable action has the integration it needs; a schedule is in the future
// and recurs from every minute to once a year.

const triggerMetadata = {
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(240),
};

const draftTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MANUAL"), ...triggerMetadata }),
  z.object({
    type: z.literal("SCHEDULE"),
    ...triggerMetadata,
    nextRunAt: z.string(),
    intervalMinutes: z
      .number()
      .int()
      .min(AGENT_TRIGGER_INTERVAL_MINUTES.min)
      .max(AGENT_TRIGGER_INTERVAL_MINUTES.max),
  }),
  z.object({
    type: z.literal("EVENT"),
    ...triggerMetadata,
    event: z.enum(CRM_EVENT_TYPES),
  }),
]);

const draftAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE),
    provider: z.literal("crm"),
    summary: z.string().trim().min(1).max(240),
    activityTypes: z
      .array(z.enum(["NOTE", "TASK"]))
      .min(1)
      .max(2),
  }),
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.RUN_SUMMARY),
    provider: z.literal("crm"),
    summary: z.string().trim().min(1).max(240),
  }),
  z.object({
    type: z.literal(AGENT_ACTION_TYPES.SLACK_MESSAGE_POST),
    provider: z.literal("slack"),
    summary: z.string().trim().min(1).max(240),
    destination: z.object({
      kind: z.enum(["channel", "user"]),
      resolution: z.literal("chosen"),
      id: z.string().trim().min(1).max(120),
      label: z.string().trim().min(1).max(120),
    }),
  }),
]);

export const draftInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(320),
  instructions: z.string().trim().min(40).max(20_000),
  triggers: z.array(draftTrigger).min(1).max(10),
  recordScope: z.enum(["SELECTED", "WORKSPACE"]),
  resources: z
    .array(
      z.object({
        kind: z.enum(["company", "contact", "deal"]),
        id: z.string().min(1),
        label: z.string().min(1).max(160),
      }),
    )
    .max(30),
  integrations: z.array(z.enum(["email", "calendar", "slack"])).max(3),
  actions: z.array(draftAction).min(1).max(10),
});

export type DraftInput = z.infer<typeof draftInputSchema>;

type SlackInventory = {
  connected: boolean;
  channels: Array<{ id: string; label: string }>;
  people: Array<{ id: string; label: string }>;
};

const ACTIVITY_ACCESS = {
  NOTE: "Write notes on CRM records",
  TASK: "Create tasks on CRM records",
} as const;

/** The plain-language access list the review screen shows. */
function accessOf(input: DraftInput): string[] {
  const activityTypes = new Set(
    input.actions.flatMap((action) =>
      action.type === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE
        ? action.activityTypes
        : [],
    ),
  );
  return [
    input.recordScope === "WORKSPACE"
      ? "Read workspace CRM records"
      : "Read selected CRM records",
    ...CAPTURE_KINDS.filter((kind) => input.integrations.includes(kind)).map(
      (kind) => CAPTURE_GRANTS[kind].access,
    ),
    ...(input.integrations.includes("slack")
      ? ["Post to the approved Slack destination"]
      : []),
    ...(["NOTE", "TASK"] as const)
      .filter((type) => activityTypes.has(type))
      .map((type) => ACTIVITY_ACCESS[type]),
  ];
}

/**
 * Everything wrong with a draft, in sentences the builder can fix; empty when
 * it may be saved.
 */
export function draftIssues(
  input: DraftInput,
  tagged: readonly DescribedRecord[],
  existing: readonly DescribedRecord[],
  connections: { slack: SlackInventory; capture: CaptureGrants },
  now: Date,
): string[] {
  const { slack, capture } = connections;
  const issues: string[] = [];
  if (input.recordScope === "SELECTED" && input.resources.length === 0) {
    issues.push("Selected CRM scope needs at least one tagged record.");
  }
  if (input.recordScope === "WORKSPACE" && input.resources.length > 0) {
    issues.push("Workspace CRM scope cannot also list selected records.");
  }
  const taggedLabels = new Map(
    tagged.map((record) => [`${record.kind}:${record.id}`, record.label]),
  );
  const existingKeys = new Set(
    existing.map((record) => `${record.kind}:${record.id}`),
  );
  const seen = new Set<string>();
  for (const resource of input.resources) {
    const key = `${resource.kind}:${resource.id}`;
    if (seen.has(key)) {
      issues.push(`${resource.label} is listed more than once.`);
      continue;
    }
    seen.add(key);
    const label = taggedLabels.get(key);
    if (label === undefined) {
      issues.push(`${resource.label} was not tagged in this builder chat.`);
    } else if (label !== resource.label) {
      issues.push(
        `${resource.kind} ${resource.id} must use its exact tagged label, "${label}".`,
      );
    } else if (!existingKeys.has(key)) {
      issues.push(`${resource.label} is no longer in the CRM.`);
    }
  }
  if (new Set(input.integrations).size !== input.integrations.length) {
    issues.push("An integration is listed more than once.");
  }
  if (input.integrations.includes("slack") && !slack.connected) {
    issues.push("Slack is not connected for this workspace.");
  }
  if (input.integrations.includes("email") && !capture.email) {
    issues.push(
      "Email is not connected: nobody in this workspace has connected a mailbox.",
    );
  }
  if (input.integrations.includes("calendar") && !capture.calendar) {
    issues.push(
      "Calendar is not connected: nobody in this workspace has connected a calendar.",
    );
  }

  const actionTypes = new Set<string>();
  for (const action of input.actions) {
    if (actionTypes.has(action.type)) {
      issues.push(`The ${action.type} action is listed more than once.`);
    }
    actionTypes.add(action.type);
    if (action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST) {
      if (!input.integrations.includes("slack")) {
        issues.push(
          "Posting to Slack needs Slack in this agent's integrations.",
        );
      }
      const options =
        action.destination.kind === "user" ? slack.people : slack.channels;
      const noun = action.destination.kind === "user" ? "person" : "channel";
      const option = options.find(
        (entry) => entry.id === action.destination.id,
      );
      if (!option) {
        issues.push(`The Slack ${noun} is not available to this workspace.`);
      } else if (option.label !== action.destination.label) {
        issues.push(
          `The Slack ${noun} must use its exact inspected label, "${option.label}".`,
        );
      }
    }
    if (
      action.type === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE &&
      new Set(action.activityTypes).size !== action.activityTypes.length
    ) {
      issues.push("CRM activity permissions must not repeat an activity type.");
    }
  }
  if (!actionTypes.has(AGENT_ACTION_TYPES.RUN_SUMMARY)) {
    issues.push("An agent needs one run summary action.");
  }

  const events = new Set<string>();
  let manual = 0;
  for (const trigger of input.triggers) {
    if (trigger.type === "MANUAL") manual += 1;
    if (trigger.type === "SCHEDULE") {
      const next = Date.parse(trigger.nextRunAt);
      if (!Number.isFinite(next) || next <= now.getTime()) {
        issues.push("A scheduled trigger needs a future next run time.");
      }
      if (
        !trigger.intervalMinutes ||
        trigger.intervalMinutes < AGENT_TRIGGER_INTERVAL_MINUTES.min ||
        trigger.intervalMinutes > AGENT_TRIGGER_INTERVAL_MINUTES.max
      ) {
        issues.push(
          "A scheduled trigger needs a recurrence from 1 minute to 1 year.",
        );
      }
    }
    if (trigger.type === "EVENT") {
      if (events.has(trigger.event)) {
        issues.push(`The ${trigger.event} event is already a trigger.`);
      }
      events.add(trigger.event);
      if (input.recordScope !== "WORKSPACE") {
        issues.push("Event triggers need workspace CRM scope.");
      }
    }
  }
  if (manual > 1) issues.push("An agent needs at most one manual trigger.");
  return issues;
}

function scopeSummary(input: DraftInput): string {
  return input.recordScope === "WORKSPACE"
    ? "Workspace CRM records"
    : input.resources.map((resource) => resource.label).join(" · ");
}

/** The manifest a valid draft saves as. */
export function manifestOf(input: DraftInput): AgentManifest {
  const resources: ManifestResource[] = [
    ...input.resources,
    ...CAPTURE_KINDS.filter((kind) => input.integrations.includes(kind)).map(
      (kind) => CAPTURE_GRANTS[kind].resource,
    ),
    ...(input.integrations.includes("slack") ? [SLACK_RESOURCE] : []),
  ];
  return {
    name: input.name,
    description: input.description,
    triggers: input.triggers,
    dataScope: {
      mode: input.recordScope,
      summary: scopeSummary(input),
      resources,
    },
    actions: input.actions,
    access: accessOf(input),
  };
}

export const BUILDER_FILE_PATHS = [
  "agent/README.md",
  "agent/instructions.md",
  "agent/manifest.json",
] as const;

export type BuilderFilePath = (typeof BUILDER_FILE_PATHS)[number];

export const FILE_LANGUAGES: Record<BuilderFilePath, string> = {
  "agent/README.md": "markdown",
  "agent/instructions.md": "markdown",
  "agent/manifest.json": "json",
};

/** The exact files a version is saved with. */
export function versionFiles(
  input: DraftInput,
  manifest: AgentManifest,
): Array<{ path: BuilderFilePath; content: string }> {
  const triggers = input.triggers
    .map((trigger) => `- ${trigger.summary}`)
    .join("\n");
  const access = manifest.access.map((item) => `- ${item}`).join("\n");
  return [
    {
      path: "agent/README.md",
      content: `# ${input.name}\n\n${input.description}\n\n## Triggers\n\n${triggers}\n\n## Access\n\n${access}\n`,
    },
    {
      path: "agent/instructions.md",
      content: `${input.instructions.trim()}\n`,
    },
    {
      path: "agent/manifest.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    },
  ];
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|password|secret|access[_-]?token)\b\s*[:=]\s*["']?[a-z0-9_./+=-]{12,}/i,
  /\b(?:sk|pk)_(?:live|test)_[a-z0-9]{16,}/i,
  /\bxox[abprs]-[a-z0-9-]{10,}/i,
];

/** Agent files never hold a credential. */
export function assertNoSecrets(content: string): void {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new Error("Agent files cannot contain credentials or secret values.");
  }
}

/** The CRM events an EVENT trigger may name, for inspect_context. */
export function eventCatalog() {
  return CRM_EVENT_TYPES.map((type) => ({ type, ...CRM_EVENT_CATALOG[type] }));
}
