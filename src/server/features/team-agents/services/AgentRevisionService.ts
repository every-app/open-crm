import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { AppError } from "@/server/lib/errors";
import {
  agentManifest,
  recordResources,
  slackDestinationOf,
  type AgentManifest,
} from "@/shared/team-agents";
import { AgentFileRepository } from "../repositories/AgentFileRepository";
import { assertNoSecrets } from "./draft";
import {
  grantedSources,
  onlyTakesAway,
  revisedManifest,
  takenAwayFrom,
  type ManifestChange,
} from "./manifests";
import {
  INSTRUCTIONS_PATH,
  land,
  MANIFEST_PATH,
  manifestFile,
  pageVersions,
  replayed,
  type FileEdit,
  type PageVersion,
  type RevisionOutcome,
} from "./revisionVersions";

// Changing a deployed agent from its page, as the CRM's revise and saveFile:
// turn actions off, move its Slack channel, change its records (narrowing a
// workspace-wide agent to some) and its captured email or meetings, or edit
// its files. Each change is made on the version the page shows: the one
// waiting for review if there is one, else the deployed one. Taking something
// away is a new deployed version at once (the person making it is approving
// it); giving it more, or editing its manifest, makes a version that waits
// for review (revisionVersions.ts).

type Context = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

/** Before and after of just what the request changed, for the activity. */
function revisionChange(
  input: ManifestChange,
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

function reviseSummary(input: ManifestChange): string {
  const parts: string[] = [];
  if (input.channel) parts.push(`moved to #${input.channel.name}`);
  if (input.actions) parts.push(`${input.actions.length} actions`);
  if (input.resources) parts.push(`${input.resources.length} records`);
  if (input.sources) parts.push(`${input.sources.length} captured sources`);
  return parts.length > 0 ? `Changed ${parts.join(", ")}` : "Changed settings";
}

/** The same change on the deployed version, while one waits for review. */
async function liveRevision(
  organizationId: string,
  live: PageVersion,
  shown: AgentManifest,
  input: ManifestChange,
) {
  const manifest = await revisedManifest(
    organizationId,
    live.manifest,
    takenAwayFrom(live.manifest, shown, input),
  );
  if (JSON.stringify(manifest) === JSON.stringify(live.manifest)) return null;
  return {
    manifest,
    instructions: live.version.instructions,
    edits: [{ path: MANIFEST_PATH, content: manifestFile(manifest) }],
  };
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
  input: ManifestChange & { agentId: string; clientRequestId: string },
): Promise<RevisionOutcome> {
  const { organizationId } = context;
  const { agent, live, pending } = await pageVersions(context, input.agentId);
  const replay = await replayed(
    organizationId,
    agent.id,
    input.clientRequestId,
    "agent.revised",
  );
  if (replay) return replay;

  const base = pending ?? live;
  const manifest = await revisedManifest(organizationId, base.manifest, input);
  return land(context, live, {
    base,
    manifest,
    instructions: base.version.instructions,
    edits: [{ path: MANIFEST_PATH, content: manifestFile(manifest) }],
    givesMore: !onlyTakesAway(base.manifest, manifest),
    onLive: pending
      ? await liveRevision(organizationId, live, base.manifest, input)
      : null,
    audit: {
      summary: reviseSummary(input),
      ...revisionChange(input, base.manifest, manifest),
      requestId: input.clientRequestId,
    },
    deployedAs: "agent.revised",
  });
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

/** The same file edits on the deployed version, where they change a file. */
async function liveEdits(
  organizationId: string,
  live: PageVersion,
  edits: FileEdit[],
) {
  const files = await AgentFileRepository.versionFiles(
    organizationId,
    live.version.id,
  );
  const changed = edits.filter((edit) =>
    files.some(
      (file) => file.path === edit.path && file.content !== edit.content,
    ),
  );
  if (changed.length === 0) return null;
  return {
    manifest: live.manifest,
    instructions:
      changed.find((edit) => edit.path === INSTRUCTIONS_PATH)?.content.trim() ??
      live.version.instructions,
    edits: changed,
  };
}

/**
 * Saves edits to the files of the version the page shows, as the CRM's
 * saveFile: one new revision of each edited file in one new version.
 * Instructions and the README are a new deployed version at once; a changed
 * manifest is checked and waits for review. A replayed request changes
 * nothing.
 */
async function saveFiles(
  context: Context,
  input: { agentId: string; clientRequestId: string; files: FileEdit[] },
): Promise<RevisionOutcome> {
  const { organizationId } = context;
  const { agent, live, pending } = await pageVersions(context, input.agentId);
  const replay = await replayed(
    organizationId,
    agent.id,
    input.clientRequestId,
    "agent.file.saved",
  );
  if (replay) return replay;
  const base = pending ?? live;
  const files = await AgentFileRepository.versionFiles(
    organizationId,
    base.version.id,
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
    return { saved: true, versionId: base.version.id, review: false };
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
    base.version.instructions;
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
    : { manifest: base.manifest };
  if ("issues" in proposed) return { saved: false, issues: proposed.issues };

  const edited =
    JSON.stringify(proposed.manifest) !== JSON.stringify(base.manifest);
  return land(context, live, {
    base,
    manifest: proposed.manifest,
    instructions,
    edits,
    givesMore: edited,
    onLive:
      pending && !edited ? await liveEdits(organizationId, live, edits) : null,
    audit: {
      summary: `Edited ${edits.map((edit) => edit.path).join(", ")}`,
      before: edits.map((edit) => ({
        path: edit.path,
        bytes: edit.was.length,
      })),
      after: edits.map((edit) => ({
        path: edit.path,
        bytes: edit.content.length,
      })),
      requestId: input.clientRequestId,
    },
    deployedAs: "agent.file.saved",
  });
}

export const AgentRevisionService = {
  revise,
  saveFiles,
};
