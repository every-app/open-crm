import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { Textarea } from "@/client/components/ui/textarea";
import { slackChannelsQueryOptions } from "@/client/features/slack/slackQueries";
import { ChannelPicker } from "@/client/features/slack/ChannelPicker";
import {
  reviseTeamAgent,
  saveTeamAgentInstructions,
} from "@/serverFunctions/teamAgents";
import {
  ACTION_LABELS,
  AGENT_ACTION_TYPES,
  recordResources,
  slackDestinationOf,
  type AgentManifest,
  type RecordResource,
} from "@/shared/team-agents";
import { teamAgentFilesQueryOptions, teamAgentKeys } from "./teamAgentQueries";

/**
 * The deployed version's permissions (the CRM's AgentCapabilities): turn an
 * action off, move its Slack channel, drop records from its scope, or edit its
 * instructions. Saving makes a new deployed version at once; the old one
 * stays in the history. Only its creator or an admin may change it.
 */
export function AgentCapabilities({
  agentId,
  versionId,
  manifest,
  canManage,
}: {
  agentId: string;
  /** The deployed version these permissions are. */
  versionId: string;
  manifest: AgentManifest;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [off, setOff] = useState<string[]>([]);
  const [channel, setChannel] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [records, setRecords] = useState<RecordResource[] | null>(null);
  const destination = slackDestinationOf(manifest);
  const scope = recordResources(manifest.dataScope.resources);
  const shownRecords = records ?? scope;

  const reset = () => {
    setOff([]);
    setChannel(null);
    setRecords(null);
  };
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: teamAgentKeys.agent(agentId) });

  const revise = useMutation({
    mutationFn: () =>
      reviseTeamAgent({
        data: {
          agentId,
          clientRequestId: crypto.randomUUID(),
          actions:
            off.length > 0
              ? manifest.actions
                  .map((action) => action.type)
                  .filter((type) => !off.includes(type))
              : undefined,
          channel: channel ?? undefined,
          resources: records ?? undefined,
        },
      }),
    onSuccess: async () => {
      reset();
      toast.success("Saved. A new version is live.");
      await invalidate();
    },
  });

  const dirty = off.length > 0 || channel !== null || records !== null;
  const blocked =
    records !== null &&
    manifest.dataScope.mode === "SELECTED" &&
    records.length === 0
      ? "Keep one record: an empty list would open every record in the workspace."
      : null;

  return (
    <div className="space-y-8">
      {destination ? (
        <section className="space-y-3">
          <SectionHeader
            title="Lives in"
            hint={`Posts to ${channel ? `#${channel.name}` : destination.label}. The app joins a new channel when you save.`}
          />
          {canManage && destination.kind === "channel" ? (
            <SlackChannelChoice
              value={channel?.id ?? destination.id}
              onSelect={setChannel}
            />
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          title="What it can do"
          hint="If it's off here, it can't do it."
        />
        <div className="divide-y divide-border rounded-lg border border-border">
          {manifest.actions.map((action) => (
            <div
              key={action.type}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {ACTION_LABELS[action.type] ?? action.type}
                </p>
                <p className="text-xs text-muted-foreground">
                  {action.summary}
                </p>
              </div>
              <Switch
                checked={!off.includes(action.type)}
                disabled={
                  !canManage ||
                  revise.isPending ||
                  action.type === AGENT_ACTION_TYPES.RUN_SUMMARY
                }
                aria-label={`Allow: ${ACTION_LABELS[action.type] ?? action.type}`}
                onCheckedChange={(on) =>
                  setOff((current) =>
                    on
                      ? current.filter((type) => type !== action.type)
                      : [...current, action.type],
                  )
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="What it can see"
          hint={manifest.dataScope.summary}
        />
        <div className="flex flex-wrap gap-2">
          {manifest.dataScope.mode === "WORKSPACE" ? (
            <span className="rounded-md border border-border px-2.5 py-1 text-sm">
              Every record in the workspace
            </span>
          ) : (
            shownRecords.map((record) => (
              <span
                key={`${record.kind}:${record.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border py-1 pr-1.5 pl-2.5 text-sm"
              >
                {record.label}
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Remove ${record.label}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setRecords(
                        shownRecords.filter((entry) => entry !== record),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))
          )}
        </div>
      </section>

      {dirty ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-popover p-3 shadow-lg">
          <p className="min-w-0 flex-1 text-sm">
            {blocked ??
              "Saving makes a new version live. The old one stays in the history."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={revise.isPending}
            onClick={reset}
          >
            Discard
          </Button>
          <Button
            size="sm"
            pending={revise.isPending}
            disabled={blocked !== null}
            onClick={() => revise.mutate()}
          >
            Save
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <InstructionsEditor agentId={agentId} versionId={versionId} />
      ) : null}
    </div>
  );
}

/** The Slack channels the app can reach, to move the agent to one. */
function SlackChannelChoice({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (channel: { id: string; name: string }) => void;
}) {
  const channels = useQuery(slackChannelsQueryOptions(""));
  if (!channels.data) {
    return channels.isError ? (
      <p className="text-sm text-muted-foreground">
        Slack isn't connected, so the channel can't be changed here.
      </p>
    ) : null;
  }
  return (
    <ChannelPicker
      channels={channels.data.rows}
      canInviteItself={channels.data.canInviteItself}
      value={value}
      onSelect={(channel) => onSelect({ id: channel.id, name: channel.name })}
    />
  );
}

/** Edits the deployed version's instructions as a new deployed version. */
function InstructionsEditor({
  agentId,
  versionId,
}: {
  agentId: string;
  versionId: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const files = useQuery(teamAgentFilesQueryOptions(agentId, versionId));
  const saved =
    files.data?.files.find((file) => file.path === "agent/instructions.md")
      ?.content ?? "";
  const save = useMutation({
    mutationFn: (content: string) =>
      saveTeamAgentInstructions({
        data: { agentId, clientRequestId: crypto.randomUUID(), content },
      }),
    onSuccess: async () => {
      setDraft(null);
      toast.success("Saved. A new version is live.");
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
    },
  });
  if (!files.data) return null;
  const value = draft ?? saved;
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Instructions"
        hint="What the agent is told to do, within the permissions above."
      />
      <Textarea
        value={value}
        rows={8}
        className="font-mono text-xs"
        aria-label="Agent instructions"
        onChange={(event) => setDraft(event.target.value)}
      />
      {draft !== null && draft.trim() !== saved.trim() ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
            Discard
          </Button>
          <Button
            size="sm"
            pending={save.isPending}
            disabled={draft.trim().length < 40}
            onClick={() => save.mutate(draft)}
          >
            Save instructions
          </Button>
        </div>
      ) : null}
    </section>
  );
}
