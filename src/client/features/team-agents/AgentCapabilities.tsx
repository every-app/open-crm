import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Switch } from "@/client/components/ui/switch";
import { ChannelPicker } from "@/client/features/slack/ChannelPicker";
import { CreateChannelDialog } from "@/client/features/slack/CreateChannelDialog";
import {
  slackChannelsQueryOptions,
  slackKeys,
} from "@/client/features/slack/slackQueries";
import { joinSlackChannel } from "@/serverFunctions/slack";
import {
  reviseTeamAgent,
  saveTeamAgentFiles,
} from "@/serverFunctions/teamAgents";
import {
  ACTION_LABELS,
  AGENT_ACTION_TYPES,
  CAPTURE_KINDS,
  captureGrants,
  recordResources,
  slackDestinationOf,
  type AgentManifest,
  type CaptureKind,
  type RecordResource,
  type SlackDestination,
} from "@/shared/team-agents";
import { AgentCode, MANIFEST_PATH } from "./AgentCode";
import { AgentScope, recordKey, ReviewLabel } from "./AgentScope";
import { SaveBar } from "./agentEditing";
import { teamAgentFilesQueryOptions, teamAgentKeys } from "./teamAgentQueries";

type Channel = { id: string; name: string };

/**
 * The agent's permissions and code (the CRM's agent capabilities and agent
 * code): where it posts, what it can do there, what it can see, and its
 * files, as the version waiting for review has them when there is one (what
 * the deployed version lacks is marked), else as deployed. Its creator or an
 * admin changes them, and the changes wait in one save bar for the page.
 * Taking something away goes live at once; giving it more, or editing its
 * manifest, makes a version to review and deploy. Saving or discarding
 * starts the page afresh (`onReset`).
 */
export function AgentCapabilities({
  agentId,
  versionId,
  manifest,
  live,
  canManage,
  onReset,
}: {
  agentId: string;
  versionId: string;
  manifest: AgentManifest;
  /** The deployed version, when the one shown waits for review. */
  live: AgentManifest | null;
  canManage: boolean;
  onReset: () => void;
}) {
  const queryClient = useQueryClient();
  const destination = slackDestinationOf(manifest);
  const workspace = manifest.dataScope.mode === "WORKSPACE";
  const scope = recordResources(manifest.dataScope.resources);
  const granted = captureGrants(manifest.dataScope.resources);
  const files = useQuery(teamAgentFilesQueryOptions(agentId, versionId));
  // What the version shown has and the deployed one doesn't: it waits.
  const liveKeys = new Set(live?.dataScope.resources.map(recordKey));
  const inReview = live
    ? new Set([
        ...manifest.dataScope.resources
          .map(recordKey)
          .filter((key) => !liveKeys.has(key)),
        ...manifest.actions
          .map((action) => action.type)
          .filter(
            (type) => !live.actions.some((action) => action.type === type),
          ),
      ])
    : new Set<string>();
  const moveInReview =
    live !== null && destination?.id !== slackDestinationOf(live)?.id;

  const [channel, setChannel] = useState<Channel | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordResource[] | null>(null);
  const [sources, setSources] = useState<CaptureKind[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]);

  const shownRecords = records ?? scope;
  const shownSources = sources ?? CAPTURE_KINDS.filter((kind) => granted[kind]);
  const moving = channel !== null && channel.id !== destination?.id;
  const edited = (files.data?.files ?? []).filter(
    (file) =>
      drafts[file.path] !== undefined && drafts[file.path] !== file.content,
  );
  const changed =
    moving || off.length > 0 || records !== null || sources !== null;
  const had = new Set(scope.map(recordKey));
  // Records named for a workspace-wide agent narrow it.
  const widens =
    (!workspace &&
      shownRecords.some((record) => !had.has(recordKey(record)))) ||
    shownSources.some((kind) => !granted[kind]);
  // An empty list would open every record in the workspace.
  const blocked = records !== null && !workspace && records.length === 0;

  const save = useMutation({
    mutationFn: async () => {
      // Files first: the checks may refuse them, and then nothing is saved.
      const saved =
        edited.length > 0
          ? await saveTeamAgentFiles({
              data: {
                agentId,
                clientRequestId: crypto.randomUUID(),
                files: edited.map((file) => ({
                  path: file.path,
                  content: drafts[file.path] ?? file.content,
                })),
              },
            })
          : null;
      if (saved?.saved === false || !changed) return { saved, revised: null };
      const revised = await reviseTeamAgent({
        data: {
          agentId,
          clientRequestId: crypto.randomUUID(),
          channel: moving ? channel : undefined,
          actions:
            off.length > 0
              ? manifest.actions
                  .map((action) => action.type)
                  .filter((type) => !off.includes(type))
              : undefined,
          resources: records ?? undefined,
          sources: sources ?? undefined,
        },
      });
      return { saved, revised };
    },
    onSuccess: async ({ saved, revised }) => {
      if (saved?.saved === false) {
        setIssues(saved.issues);
        return;
      }
      if (revised?.saved === false) {
        toast.error(revised.issues.join(" "));
        // Nothing was saved: the changes stay to fix.
        if (!saved) return;
      } else {
        toast.success(
          saved?.review || revised?.review ? "Saved for review." : "Saved.",
        );
      }
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
      onReset();
    },
  });

  const from = destination?.label.replace(/^#/, "");
  const note = blocked
    ? "Add one record."
    : widens
      ? "Added access waits for review before it runs."
      : edited.some((file) => file.path === MANIFEST_PATH)
        ? "A changed manifest waits for review."
        : moving
          ? `The CRM joins #${channel.name} and stays in #${from} until you remove it.`
          : null;

  return (
    <>
      {destination ? (
        <LivesIn
          destination={destination}
          inReview={moveInReview}
          canManage={canManage}
          picked={channel}
          pending={save.isPending}
          onPick={setChannel}
        />
      ) : null}
      <WhatItCanDo
        manifest={manifest}
        inReview={inReview}
        canManage={canManage}
        off={off}
        pending={save.isPending}
        onChange={setOff}
      />
      <AgentScope
        workspace={workspace}
        // An event trigger needs every record in the workspace.
        narrowable={
          !manifest.triggers.some((trigger) => trigger.type === "EVENT")
        }
        records={shownRecords}
        sources={shownSources}
        inReview={inReview}
        canManage={canManage}
        disabled={save.isPending}
        onRecords={setRecords}
        onSources={setSources}
      />
      <SettingsSection title="Code">
        <AgentCode
          agentId={agentId}
          versionId={versionId}
          edits={
            canManage
              ? {
                  drafts,
                  issues,
                  onDraft: (path, content) => {
                    setIssues([]);
                    setDrafts((current) => ({ ...current, [path]: content }));
                  },
                }
              : undefined
          }
        />
      </SettingsSection>
      {changed || edited.length > 0 ? (
        <SaveBar
          note={note}
          blocked={blocked}
          pending={save.isPending}
          onDiscard={onReset}
          onSave={() => save.mutate()}
        />
      ) : null}
    </>
  );
}

/** The one Slack channel it posts to, and moving it to another. */
function LivesIn({
  destination,
  inReview,
  canManage,
  picked,
  pending,
  onPick,
}: {
  destination: SlackDestination;
  /** A move to `destination` waits for review. */
  inReview: boolean;
  canManage: boolean;
  picked: Channel | null;
  pending: boolean;
  onPick: (channel: Channel) => void;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const isChannel = destination.kind === "channel";
  const channels = useQuery({
    ...slackChannelsQueryOptions(""),
    enabled: isChannel,
  });
  const join = useMutation({
    mutationFn: (channelId: string) =>
      joinSlackChannel({ data: { channelId } }),
    onSuccess: async (result) => {
      if (result.outcome === "failed") toast.error(result.reason);
      else
        toast.success(
          result.outcome === "asked"
            ? "Asked someone to invite the CRM."
            : result.outcome === "joined"
              ? "The CRM joined the channel."
              : "The CRM is already in there.",
        );
      await queryClient.invalidateQueries({ queryKey: slackKeys.all });
    },
  });

  return (
    <SettingsSection
      title={<ReviewLabel label="Lives in" inReview={inReview} />}
      action={
        canManage && isChannel && channels.data ? (
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            Create a channel
          </Button>
        ) : null
      }
    >
      <SettingsCard>
        {!isChannel ? (
          <SettingsRow label={destination.label} />
        ) : channels.data ? (
          <ChannelPicker
            className="rounded-none border-0 shadow-none"
            channels={channels.data.rows}
            canInviteItself={channels.data.canInviteItself}
            value={picked?.id ?? destination.id}
            pending={pending || join.isPending}
            onSelect={
              canManage
                ? (channel) => onPick({ id: channel.id, name: channel.name })
                : undefined
            }
            onRequest={
              canManage ? (channel) => join.mutate(channel.id) : undefined
            }
          />
        ) : channels.isError ? (
          <SettingsRow
            label={destination.label}
            description="Slack isn't connected."
          />
        ) : (
          <div className="px-5 py-4">
            <Skeleton className="h-5 w-40" />
          </div>
        )}
      </SettingsCard>
      {creating ? (
        <CreateChannelDialog onClose={() => setCreating(false)} />
      ) : null}
    </SettingsSection>
  );
}

/** Its actions, each one it may take switched on or off. */
function WhatItCanDo({
  manifest,
  inReview,
  canManage,
  off,
  pending,
  onChange,
}: {
  manifest: AgentManifest;
  /** The actions that wait for review. */
  inReview: ReadonlySet<string>;
  canManage: boolean;
  /** The actions switched off and not saved yet. */
  off: string[];
  pending: boolean;
  onChange: (off: string[]) => void;
}) {
  return (
    <SettingsSection title="What it can do there">
      <SettingsCard>
        {manifest.actions.map((action) => {
          const label = ACTION_LABELS[action.type] ?? action.type;
          return (
            <SettingsRow
              key={action.type}
              label={
                <ReviewLabel
                  label={label}
                  inReview={inReview.has(action.type)}
                />
              }
              description={action.summary || action.provider}
            >
              <Switch
                checked={!off.includes(action.type)}
                disabled={
                  !canManage ||
                  pending ||
                  action.type === AGENT_ACTION_TYPES.RUN_SUMMARY
                }
                aria-label={`Allow: ${label}`}
                onCheckedChange={(on) =>
                  onChange(
                    on
                      ? off.filter((type) => type !== action.type)
                      : [...off, action.type],
                  )
                }
              />
            </SettingsRow>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}
