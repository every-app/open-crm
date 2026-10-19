import { sortBy } from "remeda";
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
import { BuilderRepository } from "../repositories/BuilderRepository";
import { nextSlot } from "./TriggerService";

// A version's manifest: read back from the database, and changed from the
// agent's page as the CRM's revise changed it (actions off, another Slack
// channel, its records and the captured sources it reads). What a change
// gives the agent decides whether it goes live at once or waits for review
// (revisionVersions.ts).

/** A manifest the review screen can show, or why it can't. */
export function readable(
  manifest: unknown,
):
  | { readable: true; manifest: AgentManifest }
  | { readable: false; problem: string } {
  const parsed = agentManifest.safeParse(manifest);
  if (parsed.success) return { readable: true, manifest: parsed.data };
  return {
    readable: false,
    problem: parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"} ${issue.message}`)
      .join("; "),
  };
}

/** What a change from the agent's page asks of a manifest. */
export type ManifestChange = {
  actions?: string[];
  channel?: { id: string; name: string };
  resources?: RecordResource[];
  /** The captured sources it reads. */
  sources?: CaptureKind[];
};

const recordKey = (record: { kind: string; id: string }) =>
  `${record.kind}:${record.id}`;

export const grantedSources = (manifest: AgentManifest) => {
  const granted = captureGrants(manifest.dataScope.resources);
  return CAPTURE_KINDS.filter((kind) => granted[kind]);
};

const postsToSlack = (actions: AgentManifest["actions"]) =>
  actions.some(
    (action) => action.type === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
  );

/** The actions kept, and the Slack destination moved, as `change` asks. */
function revisedActions(
  manifest: AgentManifest,
  change: ManifestChange,
): AgentManifest["actions"] {
  let actions = manifest.actions;
  if (change.actions) {
    const keep = new Set(change.actions);
    actions = actions.filter((action) => keep.has(action.type));
    if (
      !actions.some((action) => action.type === AGENT_ACTION_TYPES.RUN_SUMMARY)
    ) {
      throw new AppError("VALIDATION_ERROR", "An agent keeps its run summary.");
    }
  }
  const channel = change.channel;
  if (!channel) return actions;
  if (!postsToSlack(actions)) {
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
 * The resources the revised manifest reads: the records asked for (by the
 * CRM's labels), the captured sources asked for, and Slack only while it
 * still posts there.
 */
async function revisedScope(
  organizationId: string,
  manifest: AgentManifest,
  change: ManifestChange,
  slack: boolean,
): Promise<AgentManifest["dataScope"]> {
  let dataScope = manifest.dataScope;
  if (change.resources) {
    if (
      manifest.dataScope.mode === "SELECTED" &&
      change.resources.length === 0
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Add one record. An empty list opens every record in the workspace.",
      );
    }
    // The CRM's own labels, in the order they were asked for.
    const order = new Map(
      change.resources.map((record, index) => [recordKey(record), index]),
    );
    const described = sortBy(
      await BuilderRepository.describeRecords(organizationId, change.resources),
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
  const keep = change.sources
    ? new Set<string>(change.sources.map(sourceId))
    : null;
  const resources = dataScope.resources.filter((resource) =>
    resource.id === SLACK_RESOURCE.id
      ? slack
      : !captureIds.has(resource.id) || !keep || keep.has(resource.id),
  );
  const added = CAPTURE_KINDS.filter(
    (kind) =>
      keep?.has(sourceId(kind)) &&
      !resources.some((resource) => resource.id === sourceId(kind)),
  ).map((kind) => CAPTURE_GRANTS[kind].resource);
  return { ...dataScope, resources: [...resources, ...added] };
}

/**
 * `manifest` as `change` asks, as the CRM's revise made it. A workspace-wide
 * agent reads every record already: naming some narrows it, as long as no
 * event trigger needs the whole workspace.
 */
export async function revisedManifest(
  organizationId: string,
  manifest: AgentManifest,
  change: ManifestChange,
): Promise<AgentManifest> {
  const actions = revisedActions(manifest, change);
  const dataScope = await revisedScope(
    organizationId,
    manifest,
    change,
    postsToSlack(actions),
  );
  if (
    manifest.dataScope.mode === "WORKSPACE" &&
    dataScope.mode === "SELECTED" &&
    manifest.triggers.some((trigger) => trigger.type === "EVENT")
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Event triggers need workspace CRM scope.",
    );
  }
  const dropped = new Set<string>(
    CAPTURE_KINDS.filter(
      (kind) => change.sources && !change.sources.includes(kind),
    ).map((kind) => CAPTURE_GRANTS[kind].access),
  );
  return {
    ...manifest,
    actions,
    dataScope,
    access: manifest.access.filter((line) => !dropped.has(line)),
  };
}

const actionTypes = (manifest: AgentManifest): string[] =>
  manifest.actions.map((action) => action.type);

/**
 * What of `had` a list made on `shown` keeps: what it lists, and what
 * `shown` didn't have to take off. Undefined when that is all of it.
 */
function kept<T>(had: T[], shown: T[], listed: T[] | undefined) {
  if (!listed) return undefined;
  const values = had.filter(
    (value) => listed.includes(value) || !shown.includes(value),
  );
  return values.length < had.length ? values : undefined;
}

/**
 * What `change`, made on the version waiting for review (`shown`), takes
 * away from the deployed one (`live`): the actions it switched off, the
 * records and captured sources it removed, and another Slack channel. The
 * deployed one keeps its last record (with none it would read every record),
 * and stays workspace-wide while an event trigger needs it: those wait with
 * the rest.
 */
export function takenAwayFrom(
  live: AgentManifest,
  shown: AgentManifest,
  change: ManifestChange,
): ManifestChange {
  const listed = new Set(change.resources?.map(recordKey));
  const shownRecords = new Set(
    recordResources(shown.dataScope.resources).map(recordKey),
  );
  const liveRecords = recordResources(live.dataScope.resources);
  const keptRecords = liveRecords.filter(
    (record) =>
      listed.has(recordKey(record)) || !shownRecords.has(recordKey(record)),
  );
  const narrows =
    live.dataScope.mode === "WORKSPACE" &&
    shown.dataScope.mode === "WORKSPACE" &&
    !live.triggers.some((trigger) => trigger.type === "EVENT");
  const resources = !change.resources
    ? undefined
    : live.dataScope.mode === "WORKSPACE"
      ? narrows && change.resources.length > 0
        ? change.resources
        : undefined
      : keptRecords.length > 0 && keptRecords.length < liveRecords.length
        ? keptRecords
        : undefined;
  return {
    actions: kept(actionTypes(live), actionTypes(shown), change.actions),
    channel:
      slackDestinationOf(live)?.kind === "channel" ? change.channel : undefined,
    resources,
    sources: kept(grantedSources(live), grantedSources(shown), change.sources),
  };
}

/** An action as it compares: its Slack destination is its maker's to move. */
const withoutDestination = (action: AgentManifest["actions"][number]) =>
  JSON.stringify({ ...action, destination: undefined });

/** What a change from the page never touches; a schedule's next run moves on by itself. */
const unchanged = (manifest: AgentManifest) =>
  JSON.stringify([
    manifest.name,
    manifest.description,
    manifest.triggers.map((trigger) => ({ ...trigger, nextRunAt: undefined })),
  ]);

/**
 * Whether `next` gives the agent nothing `from` doesn't: no record or
 * integration it didn't have (any records narrow a workspace-wide one), no
 * action it didn't have or with more to it, and the same name, description
 * and triggers. Another Slack channel is its maker's to choose, as the CRM
 * moved it on every revise.
 */
export function onlyTakesAway(
  from: AgentManifest,
  next: AgentManifest,
): boolean {
  const workspace = from.dataScope.mode === "WORKSPACE";
  const had = new Set(from.dataScope.resources.map(recordKey));
  if (next.dataScope.mode === "WORKSPACE" && !workspace) return false;
  const more = next.dataScope.resources.some(
    (resource) =>
      !had.has(recordKey(resource)) &&
      (!workspace || resource.kind === "integration"),
  );
  if (more) return false;
  const actions = new Set(from.actions.map(withoutDestination));
  if (!next.actions.every((value) => actions.has(withoutDestination(value)))) {
    return false;
  }
  return unchanged(next) === unchanged(from);
}

/** The draft a manifest amounts to, as the builder's save_agent_draft takes it. */
export function draftOf(
  manifest: AgentManifest,
  instructions: string,
  now: Date,
) {
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

export const KNOWN_INTEGRATIONS = new Set<string>([
  ...CAPTURE_KINDS.map((kind) => CAPTURE_GRANTS[kind].resource.id),
  SLACK_RESOURCE.id,
]);
