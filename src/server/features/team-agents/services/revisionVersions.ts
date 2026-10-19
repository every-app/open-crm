import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { AppError } from "@/server/lib/errors";
import {
  AGENT_ACTION_TYPES,
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
import {
  draftOf,
  KNOWN_INTEGRATIONS,
  onlyTakesAway,
  readable,
} from "./manifests";

// How a change made on a deployed agent's page lands. The page shows, and its
// changes build on, the version waiting for review when there is one, else
// the deployed one. One its maker may approve on the spot (turning things
// off, another Slack channel, fewer records, edited instructions) is a new
// deployed version at once, with the triggers moved over; what waits keeps
// waiting, saved again with the same change. One that gives the agent more
// (another record, captured email or meetings) or edits its manifest is
// checked as the builder checks a draft and saved as a version that waits for
// a person to deploy it. Deploying stays the approval boundary.

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

/** A version and its manifest, as a change from the agent's page reads it. */
export type PageVersion = { version: VersionRow; manifest: AgentManifest };

function pageVersion(version: VersionRow): PageVersion | null {
  const manifest = readable(version.manifest);
  return manifest.readable ? { version, manifest: manifest.manifest } : null;
}

/**
 * The versions a change from the agent's page reads: the deployed one, and
 * the one waiting for review, if any, which the page shows and changes build
 * on. One waiting with a manifest that can't be read is passed over: the
 * change builds on the deployed version and takes its place.
 */
export async function pageVersions(context: Context, agentId: string) {
  const agent = await manageableAgent(context, agentId);
  if (!agent.currentVersionId) {
    throw new AppError("CONFLICT", "Deploy this agent before changing it.");
  }
  const [deployed, review] = await Promise.all([
    AgentVersionRepository.findVersion(
      context.organizationId,
      agent.id,
      agent.currentVersionId,
    ),
    AgentVersionRepository.reviewVersion(
      context.organizationId,
      agent.id,
      agent.currentVersionId,
    ),
  ]);
  if (!deployed) throw new AppError("NOT_FOUND");
  const live = pageVersion(deployed);
  if (!live) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This version's manifest is unreadable, so it can't be changed.",
    );
  }
  return { agent, live, pending: review ? pageVersion(review) : null };
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
 * Puts the CRM in the Slack channel a deployed version newly posts to, as the
 * CRM's revise did; a channel it can't join shows on the Slack card, and a
 * run says so if it can't post.
 */
export async function joinMovedChannel(
  context: Context,
  before: AgentManifest | null,
  after: AgentManifest,
): Promise<void> {
  const moved = slackDestinationOf(after);
  if (
    !before ||
    moved?.kind !== "channel" ||
    moved.id === slackDestinationOf(before)?.id
  ) {
    return;
  }
  await SlackInventoryService.joinChannel(context, moved.id).catch(
    (error: unknown) => {
      console.warn("[team-agents] could not join the new channel", error);
    },
  );
}

type DeployNow = {
  /** The deployed version it replaces, whose triggers move onto it. */
  replacing: PageVersion;
  /** The version whose files it carries, `edits` applied. */
  from: VersionRow;
  instructions: string;
  manifest: AgentManifest;
  edits: FileEdit[];
  audit: Change & { type: string };
};

/**
 * A change its maker approves: a new deployed version at once, the agent's
 * triggers moved onto it and the old version kept in the history.
 */
async function deployNow(
  context: Context,
  input: DeployNow,
): Promise<string> {
  const { organizationId } = context;
  const { from, replacing } = input;
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
    fromVersionId: replacing.version.id,
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
  await joinMovedChannel(context, replacing.manifest, input.manifest);
  return versionId;
}

/**
 * A change that gives the agent more, or edits its manifest: checked as the
 * builder checks a draft (records by the CRM's own labels), then saved as a
 * READY version with its own triggers, off until a person deploys it. The
 * deployed version keeps running meanwhile. `deployFirst`, the same change
 * made to the deployed version, goes live once the checks pass, before this
 * version is saved, so this one stays the newest.
 */
async function saveForReview(
  context: Context,
  input: {
    from: VersionRow;
    manifest: AgentManifest;
    instructions: string;
    edits: FileEdit[];
    audit: Change;
    deployFirst?: DeployNow;
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
  // The Slack destination of the version it builds on was checked when that
  // version was saved, and stays approved, as the CRM never checked it again
  // on a revision: a channel renamed since keeps its place, under the name
  // Slack now gives it.
  const built = readable(from.manifest);
  const kept = built.readable ? slackDestinationOf(built.manifest) : null;
  const actions = parsed.data.actions.map((action) => {
    if (
      action.type !== AGENT_ACTION_TYPES.SLACK_MESSAGE_POST ||
      action.destination.kind !== kept?.kind ||
      action.destination.id !== kept.id
    ) {
      return action;
    }
    const current = (kept.kind === "user" ? slack.people : slack.channels).find(
      (entry) => entry.id === kept.id,
    );
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

  const deployedId = input.deployFirst
    ? await deployNow(context, input.deployFirst)
    : null;
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
  return deployedId
    ? { saved: true, versionId: deployedId, review: false }
    : { saved: true, versionId, review: true };
}

/** A change from the agent's page, made on the version the page shows. */
type PageChange = {
  /** The version waiting for review, if any, else the deployed one. */
  base: PageVersion;
  manifest: AgentManifest;
  instructions: string;
  edits: FileEdit[];
  /** It gives more than its base: another record or source, or a manifest edit. */
  givesMore: boolean;
  /** The same change made to the deployed version, when it changes it. */
  onLive: Pick<DeployNow, "manifest" | "instructions" | "edits"> | null;
  audit: Change;
  /** The audit line's type when it goes live at once. */
  deployedAs: string;
};

/**
 * Where a change from the agent's page lands. When it gives the agent
 * nothing it doesn't run with already, it goes live at once and nothing
 * waits any more. When it gives more than the version it was made on, it
 * waits for review, built on that version. When it only takes away while the
 * version waiting still gives more, the same change goes live at once on the
 * deployed version, and the waiting one is saved again with it, so what waits
 * keeps waiting.
 */
export async function land(
  context: Context,
  live: PageVersion,
  change: PageChange,
): Promise<RevisionOutcome> {
  const { base, manifest, instructions, edits } = change;
  const audit = { type: change.deployedAs, ...change.audit };
  if (!change.givesMore && onlyTakesAway(live.manifest, manifest)) {
    const versionId = await deployNow(context, {
      replacing: live,
      from: base.version,
      instructions,
      manifest,
      edits,
      audit,
    });
    return { saved: true, versionId, review: false };
  }
  return saveForReview(context, {
    from: base.version,
    manifest,
    instructions,
    edits,
    audit: change.audit,
    deployFirst:
      !change.givesMore && change.onLive
        ? { replacing: live, from: live.version, ...change.onLive, audit }
        : undefined,
  });
}
