import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { AppError } from "@/server/lib/errors";
import {
  AGENT_ACTION_TYPES,
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  recordResources,
  SLACK_RESOURCE,
  slackDestinationOf,
  type AgentManifest,
} from "@/shared/team-agents";
import {
  AgentFileRepository,
  type NewArtifact,
} from "../repositories/AgentFileRepository";
import {
  AgentVersionRepository,
  type VersionRow,
} from "../repositories/AgentVersionRepository";
import { AuditRepository } from "../repositories/AuditRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { manageableAgent } from "./access";
import { BuilderToolService } from "./BuilderToolService";
import { draftInputSchema, draftIssues, manifestOf } from "./draft";
import { readable } from "./TeamAgentService";
import { nextSlot } from "./TriggerService";

// How a change made on a deployed agent's page lands. One its maker may
// approve on the spot (turning things off, another Slack channel, fewer
// records, edited instructions) is a new deployed version at once, with the
// triggers moved over. One that gives the agent more (another record,
// captured email or meetings) or edits its manifest is checked as the
// builder checks a draft and saved as a version that waits for a person to
// deploy it. Deploying stays the approval boundary.

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

export const INSTRUCTIONS_PATH = "agent/instructions.md";
export const MANIFEST_PATH = "agent/manifest.json";

export type FileEdit = { path: string; content: string };

/** What a change from the agent's page came to. */
export type RevisionOutcome =
  | { saved: true; versionId: string; review: boolean }
  | { saved: false; issues: string[] };

type Change = {
  summary: string;
  before: unknown;
  after: unknown;
  requestId: string;
};

/** The deployed version, for a change made from the agent's page. */
export async function deployedVersion(context: Context, agentId: string) {
  const agent = await manageableAgent(context, agentId);
  if (!agent.currentVersionId) {
    throw new AppError("CONFLICT", "Deploy this agent before changing it.");
  }
  const version = await AgentVersionRepository.findVersion(
    context.organizationId,
    agent.id,
    agent.currentVersionId,
  );
  if (!version) throw new AppError("NOT_FOUND");
  const manifest = readable(version.manifest);
  if (!manifest.readable) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This version's manifest is unreadable, so it can't be changed.",
    );
  }
  return { agent, version, manifest: manifest.manifest };
}

/** What an earlier request with this id already did, if anything. */
export async function replayed(
  organizationId: string,
  agentId: string,
  requestId: string,
  deployedAs: string,
): Promise<RevisionOutcome | null> {
  for (const type of [deployedAs, "version.created"]) {
    const row = await AuditRepository.findAudit(
      organizationId,
      agentId,
      type,
      requestId,
    );
    if (row?.versionId) {
      return {
        saved: true,
        versionId: row.versionId,
        review: type === "version.created",
      };
    }
  }
  return null;
}

/** The manifest as its file holds it. */
export const manifestFile = (manifest: AgentManifest) =>
  `${JSON.stringify(manifest, null, 2)}\n`;

/** `fromVersionId`'s files carried onto `versionId`, with `edits` applied. */
async function carriedFiles(
  organizationId: string,
  fromVersionId: string,
  versionId: string,
  edits: FileEdit[],
): Promise<NewArtifact[]> {
  const rows = await AgentFileRepository.versionFiles(
    organizationId,
    fromVersionId,
  );
  const edited = new Map(edits.map((edit) => [edit.path, edit.content]));
  return rows.map((row) => {
    const content = edited.get(row.path);
    const changed = content !== undefined && content !== row.content;
    return {
      id: crypto.randomUUID(),
      organizationId,
      conversationId: null,
      versionId,
      path: row.path,
      language: row.language,
      content: changed ? content : row.content,
      previousContent: changed ? row.content : row.previousContent,
      revision: changed ? row.revision + 1 : row.revision,
      status: "READY",
    };
  });
}

async function nextNumber(organizationId: string, agentId: string) {
  const latest = await AgentVersionRepository.latestVersion(
    organizationId,
    agentId,
  );
  return (latest?.number ?? 0) + 1;
}

/**
 * A change its maker approves: a new deployed version at once, the agent's
 * triggers moved onto it and the old version kept in the history.
 */
export async function deployNow(
  context: Context,
  input: {
    from: VersionRow;
    instructions: string;
    manifest: AgentManifest;
    edits: FileEdit[];
    audit: Change & { type: string };
  },
): Promise<string> {
  const { organizationId } = context;
  const { from } = input;
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await AgentVersionRepository.replaceCurrentVersion({
    version: {
      id: versionId,
      organizationId,
      agentId: from.agentId,
      number: await nextNumber(organizationId, from.agentId),
      status: "DEPLOYED",
      instructions: input.instructions,
      manifest: input.manifest,
      sourceConversationId: from.sourceConversationId,
      createdById: context.userId,
      approvedAt: now,
      deployedAt: now,
    },
    fromVersionId: from.id,
    artifacts: await carriedFiles(
      organizationId,
      from.id,
      versionId,
      input.edits,
    ),
    audit: {
      organizationId,
      agentId: from.agentId,
      versionId,
      actorUserId: context.userId,
      actorType: "USER",
      ...input.audit,
    },
  });
  return versionId;
}

/** The draft a manifest amounts to, as the builder's save_agent_draft takes it. */
function draftOf(manifest: AgentManifest, instructions: string, now: Date) {
  const ids = new Set(
    manifest.dataScope.resources
      .filter((resource) => resource.kind === "integration")
      .map((resource) => resource.id),
  );
  return {
    name: manifest.name,
    description: manifest.description,
    instructions,
    // A schedule left as it was keeps its cadence from its next slot ahead.
    triggers: manifest.triggers.map((trigger) =>
      trigger.type === "SCHEDULE" &&
      Date.parse(trigger.nextRunAt) <= now.getTime()
        ? {
            ...trigger,
            nextRunAt: nextSlot(
              trigger.nextRunAt,
              trigger.intervalMinutes,
              now,
            ),
          }
        : trigger,
    ),
    recordScope: manifest.dataScope.mode,
    resources: recordResources(manifest.dataScope.resources),
    integrations: [
      ...CAPTURE_KINDS.filter((kind) =>
        ids.has(CAPTURE_GRANTS[kind].resource.id),
      ),
      ...(ids.has(SLACK_RESOURCE.id) ? ["slack" as const] : []),
    ],
    actions: manifest.actions,
  };
}

const KNOWN_INTEGRATIONS = new Set<string>([
  ...CAPTURE_KINDS.map((kind) => CAPTURE_GRANTS[kind].resource.id),
  SLACK_RESOURCE.id,
]);

/**
 * A change that gives the agent more, or edits its manifest: checked as the
 * builder checks a draft (records by the CRM's own labels), then saved as a
 * READY version with its own triggers, off until a person deploys it. The
 * deployed version keeps running meanwhile.
 */
export async function saveForReview(
  context: Context,
  input: {
    from: VersionRow;
    manifest: AgentManifest;
    instructions: string;
    edits: FileEdit[];
    audit: Change;
  },
): Promise<RevisionOutcome> {
  const { organizationId } = context;
  const { from } = input;
  const now = new Date();
  const unknown = input.manifest.dataScope.resources.filter(
    (resource) =>
      resource.kind === "integration" && !KNOWN_INTEGRATIONS.has(resource.id),
  );
  const parsed = draftInputSchema.safeParse(
    draftOf(input.manifest, input.instructions, now),
  );
  if (!parsed.success || unknown.length > 0) {
    return {
      saved: false,
      issues: [
        ...unknown.map(
          (resource) => `${resource.label} isn't an integration agents use.`,
        ),
        ...(parsed.error?.issues.map(
          (issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`,
        ) ?? []),
      ],
    };
  }
  const [existing, slack, capture] = await Promise.all([
    BuilderRepository.describeRecords(organizationId, parsed.data.resources),
    SlackInventoryService.builderInventory(organizationId),
    BuilderToolService.captureConnections(organizationId),
  ]);
  const labels = new Map(
    existing.map((record) => [`${record.kind}:${record.id}`, record.label]),
  );
  const resources = parsed.data.resources.map((record) => ({
    ...record,
    label: labels.get(`${record.kind}:${record.id}`) ?? record.label,
  }));
  // The Slack destination the deployed version posts to stays approved, as
  // the CRM never checked it again on a revision: a channel renamed since
  // keeps its place, under the name Slack now gives it.
  const deployed = readable(from.manifest);
  const kept = deployed.readable ? slackDestinationOf(deployed.manifest) : null;
  const actions = parsed.data.actions.map((action) => {
    if (
      action.type !== AGENT_ACTION_TYPES.SLACK_MESSAGE_POST ||
      action.destination.kind !== kept?.kind ||
      action.destination.id !== kept.id
    ) {
      return action;
    }
    const current = (
      kept.kind === "user" ? slack.people : slack.channels
    ).find((entry) => entry.id === kept.id);
    return {
      ...action,
      destination: {
        ...action.destination,
        label: current?.label ?? action.destination.label,
      },
    };
  });
  const draft = { ...parsed.data, resources, actions };
  // Every record it names counts as tagged: what matters is that it exists.
  const issues = draftIssues(
    draft,
    resources.map((record) => ({ ...record, detail: null })),
    existing,
    { slack, capture, kept },
    now,
  );
  if (issues.length > 0) return { saved: false, issues };

  const manifest = manifestOf(draft);
  const versionId = crypto.randomUUID();
  const number = await nextNumber(organizationId, from.agentId);
  await AgentVersionRepository.saveVersion({
    version: {
      id: versionId,
      organizationId,
      agentId: from.agentId,
      number,
      status: "READY",
      instructions: draft.instructions,
      manifest,
      sourceConversationId: from.sourceConversationId,
      createdById: context.userId,
    },
    triggers: draft.triggers.map((trigger) => ({
      id: crypto.randomUUID(),
      organizationId,
      agentId: from.agentId,
      versionId,
      type: trigger.type,
      name: trigger.name,
      summary: trigger.summary,
      event: trigger.type === "EVENT" ? trigger.event : null,
      intervalMinutes:
        trigger.type === "SCHEDULE" ? trigger.intervalMinutes : null,
      nextRunAt: trigger.type === "SCHEDULE" ? trigger.nextRunAt : null,
      enabled: false,
    })),
    artifacts: await carriedFiles(organizationId, from.id, versionId, [
      ...input.edits.filter((edit) => edit.path !== MANIFEST_PATH),
      { path: MANIFEST_PATH, content: manifestFile(manifest) },
    ]),
    claimedArtifactIds: [],
    audit: [
      {
        organizationId,
        agentId: from.agentId,
        versionId,
        actorUserId: context.userId,
        actorType: "USER",
        type: "version.created",
        ...input.audit,
        summary: `Prepared version ${number} for review: ${input.audit.summary}`,
      },
    ],
  });
  return { saved: true, versionId, review: true };
}
