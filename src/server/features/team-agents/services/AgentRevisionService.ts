import { sortBy } from "remeda";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { SlackInventoryService } from "@/server/features/slack/services/SlackInventoryService";
import { AppError } from "@/server/lib/errors";
import {
  AGENT_ACTION_TYPES,
  agentManifest,
  CAPTURE_GRANTS,
  CAPTURE_KINDS,
  captureGrants,
  recordResources,
  SLACK_RESOURCE,
  slackDestinationOf,
  type AgentManifest,
  type CaptureKind,
  type RecordResource,
} from "@/shared/team-agents";
import { AgentFileRepository } from "../repositories/AgentFileRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { assertNoSecrets } from "./draft";
import {
  deployedVersion,
  deployNow,
  INSTRUCTIONS_PATH,
  MANIFEST_PATH,
  manifestFile,
  replayed,
  saveForReview,
  type FileEdit,
  type RevisionOutcome,
} from "./revisionVersions";

// Changing a deployed agent from its page, as the CRM's revise and saveFile:
// turn actions off, move its Slack channel, change its records (narrowing a
// workspace-wide agent to some) and its captured email or meetings, or edit
// its files. Taking something away is a new deployed version at once (the
// person making it is approving it); giving it more, or editing its manifest,
// makes a version that waits for review (revisionVersions.ts).

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const grantedSources = (manifest: AgentManifest) => {
  const granted = captureGrants(manifest.dataScope.resources);
  return CAPTURE_KINDS.filter((kind) => granted[kind]);
};

const recordKey = (record: { kind: string; id: string }) =>
  `${record.kind}:${record.id}`;

/** The actions kept, and the Slack destination moved, as `input` asks. */
function revisedActions(
  manifest: AgentManifest,
  input: { actions?: string[]; channel?: { id: string; name: string } },
): AgentManifest["actions"] {
  let actions = manifest.actions;
  if (input.actions) {
    const keep = new Set(input.actions);
    actions = actions.filter((action) => keep.has(action.type));
    if (
      !actions.some((action) => action.type === AGENT_ACTION_TYPES.RUN_SUMMARY)
    ) {
      throw new AppError("VALIDATION_ERROR", "An agent keeps its run summary.");
    }
  }
  const channel = input.channel;
  if (!channel) return actions;
  if (
    !actions.some(
      (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
    )
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "None of this agent's actions post to Slack.",
    );
  }
  return actions.map((action) =>
    action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST
      ? {
          ...action,
          destination: {
            kind: "channel",
            resolution: "chosen",
            id: channel.id,
            label: `#${channel.name}`,
          },
        }
      : action,
  );
}

/**
 * The resources `next` reads: the records asked for (by the CRM's labels),
 * the captured sources asked for, and Slack only while it still posts there.
 */
async function revisedScope(
  organizationId: string,
  manifest: AgentManifest,
  input: { resources?: RecordResource[]; sources?: CaptureKind[] },
  postsToSlack: boolean,
): Promise<AgentManifest["dataScope"]> {
  let dataScope = manifest.dataScope;
  if (input.resources) {
    if (
      manifest.dataScope.mode === "SELECTED" &&
      input.resources.length === 0
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Add one record. An empty list opens every record in the workspace.",
      );
    }
    // The CRM's own labels, in the order they were asked for.
    const order = new Map(
      input.resources.map((record, index) => [recordKey(record), index]),
    );
    const described = sortBy(
      await BuilderRepository.describeRecords(organizationId, input.resources),
      (record) => order.get(recordKey(record)) ?? 0,
    );
    dataScope = {
      mode: described.length > 0 ? "SELECTED" : manifest.dataScope.mode,
      summary:
        described.length > 0
          ? described.map((record) => record.label).join(" · ")
          : manifest.dataScope.summary,
      resources: [
        ...described.map(({ kind, id, label }) => ({ kind, id, label })),
        ...manifest.dataScope.resources.filter(
          (resource) => resource.kind === "integration",
        ),
      ],
    };
  }
  const sourceId = (kind: CaptureKind) => CAPTURE_GRANTS[kind].resource.id;
  const captureIds = new Set<string>(CAPTURE_KINDS.map(sourceId));
  const keep = input.sources
    ? new Set<string>(input.sources.map(sourceId))
    : null;
  const resources = dataScope.resources.filter((resource) =>
    resource.id === SLACK_RESOURCE.id
      ? postsToSlack
      : !captureIds.has(resource.id) || !keep || keep.has(resource.id),
  );
  const added = CAPTURE_KINDS.filter(
    (kind) =>
      keep?.has(sourceId(kind)) &&
      !resources.some((resource) => resource.id === sourceId(kind)),
  ).map((kind) => CAPTURE_GRANTS[kind].resource);
  return { ...dataScope, resources: [...resources, ...added] };
}

/** Before and after of just what the request changed, for the activity. */
function revisionChange(
  input: {
    actions?: string[];
    channel?: { name: string };
    resources?: unknown[];
    sources?: CaptureKind[];
  },
  manifest: AgentManifest,
  next: AgentManifest,
) {
  const side = (version: AgentManifest) => ({
    ...(input.channel
      ? { channel: slackDestinationOf(version)?.label ?? null }
      : {}),
    ...(input.actions
      ? { actions: version.actions.map((action) => action.type) }
      : {}),
    ...(input.resources
      ? {
          records: recordResources(version.dataScope.resources).map(
            (record) => record.label,
          ),
        }
      : {}),
    ...(input.sources ? { sources: grantedSources(version) } : {}),
  });
  return { before: side(manifest), after: side(next) };
}

function reviseSummary(input: {
  channel?: { name: string };
  actions?: string[];
  resources?: unknown[];
  sources?: CaptureKind[];
}): string {
  const parts: string[] = [];
  if (input.channel) parts.push(`moved to #${input.channel.name}`);
  if (input.actions) parts.push(`${input.actions.length} actions`);
  if (input.resources) parts.push(`${input.resources.length} records`);
  if (input.sources) parts.push(`${input.sources.length} captured sources`);
  return parts.length > 0 ? `Changed ${parts.join(", ")}` : "Changed settings";
}

/**
 * A change from the agent's page, as the CRM's revise: turn actions off, move
 * the Slack destination, set its records, or set which captured sources it
 * reads. Taking away (narrowing a workspace-wide agent to chosen records
 * included) is a new deployed version at once, with the triggers moved over;
 * a record or a captured source it didn't have makes a version that waits
 * for review. A replayed request changes nothing.
 */
async function revise(
  context: Context,
  input: {
    agentId: string;
    clientRequestId: string;
    actions?: string[];
    channel?: { id: string; name: string };
    resources?: RecordResource[];
    /** The captured sources it reads. */
    sources?: CaptureKind[];
  },
): Promise<RevisionOutcome> {
  const { organizationId } = context;
  const { agent, version, manifest } = await deployedVersion(
    context,
    input.agentId,
  );
  const replay = await replayed(
    organizationId,
    agent.id,
    input.clientRequestId,
    "agent.revised",
  );
  if (replay) return replay;

  const actions = revisedActions(manifest, input);
  const postsToSlack = actions.some(
    (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
  );
  const dataScope = await revisedScope(
    organizationId,
    manifest,
    input,
    postsToSlack,
  );
  const droppedAccess = new Set<string>(
    CAPTURE_KINDS.filter(
      (kind) => input.sources && !input.sources.includes(kind),
    ).map((kind) => CAPTURE_GRANTS[kind].access),
  );
  const next: AgentManifest = {
    ...manifest,
    actions,
    dataScope,
    access: manifest.access.filter((line) => !droppedAccess.has(line)),
  };
  const audit = {
    summary: reviseSummary(input),
    ...revisionChange(input, manifest, next),
    requestId: input.clientRequestId,
  };

  // A workspace-wide agent reads every record already: naming some narrows
  // it, as long as no event trigger needs the whole workspace.
  const workspaceWide = manifest.dataScope.mode === "WORKSPACE";
  if (
    workspaceWide &&
    next.dataScope.mode === "SELECTED" &&
    manifest.triggers.some((trigger) => trigger.type === "EVENT")
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Event triggers need workspace CRM scope.",
    );
  }
  const had = new Set(manifest.dataScope.resources.map(recordKey));
  if (
    next.dataScope.resources.some(
      (resource) =>
        !had.has(recordKey(resource)) &&
        (!workspaceWide || resource.kind === "integration"),
    )
  ) {
    return saveForReview(context, {
      from: version,
      manifest: next,
      instructions: version.instructions,
      edits: [],
      audit,
    });
  }
  const versionId = await deployNow(context, {
    from: version,
    instructions: version.instructions,
    manifest: next,
    edits: [{ path: MANIFEST_PATH, content: manifestFile(next) }],
    audit: { type: "agent.revised", ...audit },
  });
  // Put the app in its new channel; a channel it can't join shows on the
  // Slack card, and the run says so if it can't post.
  const before = slackDestinationOf(manifest);
  if (input.channel && input.channel.id !== before?.id) {
    await SlackInventoryService.joinChannel(context, input.channel.id).catch(
      (error: unknown) => {
        console.warn("[team-agents] could not join the new channel", error);
      },
    );
  }
  return { saved: true, versionId, review: false };
}

/** The edited manifest, or what is wrong with it. */
function parseManifest(
  content: string,
): { manifest: AgentManifest } | { issues: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    return {
      issues: [
        `${MANIFEST_PATH} isn't valid JSON: ${error instanceof Error ? error.message : "it can't be read"}.`,
      ],
    };
  }
  const parsed = agentManifest.safeParse(json);
  if (parsed.success) return { manifest: parsed.data };
  return {
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`,
    ),
  };
}

const MIN_INSTRUCTIONS = 40;

/**
 * Saves edits to the deployed version's files, as the CRM's saveFile: one
 * new revision of each edited file in one new version. Instructions and the
 * README are a new deployed version at once; a changed manifest is checked
 * and waits for review. A replayed request changes nothing.
 */
async function saveFiles(
  context: Context,
  input: { agentId: string; clientRequestId: string; files: FileEdit[] },
): Promise<RevisionOutcome> {
  const { organizationId } = context;
  const { agent, version, manifest } = await deployedVersion(
    context,
    input.agentId,
  );
  const replay = await replayed(
    organizationId,
    agent.id,
    input.clientRequestId,
    "agent.file.saved",
  );
  if (replay) return replay;
  const files = await AgentFileRepository.versionFiles(
    organizationId,
    version.id,
  );
  const edits: Array<FileEdit & { was: string }> = [];
  for (const file of input.files) {
    const held = files.find((row) => row.path === file.path);
    if (!held) throw new AppError("NOT_FOUND", `No file at ${file.path}.`);
    // Files end in one newline, as the builder writes them.
    const content = `${file.content.trimEnd()}\n`;
    if (content !== held.content) {
      edits.push({ path: file.path, content, was: held.content });
    }
  }
  if (edits.length === 0) {
    return { saved: true, versionId: version.id, review: false };
  }
  try {
    for (const edit of edits) assertNoSecrets(edit.content);
  } catch {
    return {
      saved: false,
      issues: ["Agent files cannot contain credentials or secret values."],
    };
  }
  const instructions =
    edits.find((edit) => edit.path === INSTRUCTIONS_PATH)?.content.trim() ??
    version.instructions;
  if (instructions.length < MIN_INSTRUCTIONS) {
    return {
      saved: false,
      issues: [
        `The instructions need at least ${MIN_INSTRUCTIONS} characters.`,
      ],
    };
  }
  const manifestEdit = edits.find((edit) => edit.path === MANIFEST_PATH);
  const proposed = manifestEdit
    ? parseManifest(manifestEdit.content)
    : { manifest };
  if ("issues" in proposed) return { saved: false, issues: proposed.issues };

  const audit = {
    summary: `Edited ${edits.map((edit) => edit.path).join(", ")}`,
    before: edits.map((edit) => ({ path: edit.path, bytes: edit.was.length })),
    after: edits.map((edit) => ({
      path: edit.path,
      bytes: edit.content.length,
    })),
    requestId: input.clientRequestId,
  };
  if (JSON.stringify(proposed.manifest) !== JSON.stringify(manifest)) {
    return saveForReview(context, {
      from: version,
      manifest: proposed.manifest,
      instructions,
      edits,
      audit,
    });
  }
  const versionId = await deployNow(context, {
    from: version,
    instructions,
    manifest,
    edits,
    audit: { type: "agent.file.saved", ...audit },
  });
  return { saved: true, versionId, review: false };
}

export const AgentRevisionService = {
  revise,
  saveFiles,
};
