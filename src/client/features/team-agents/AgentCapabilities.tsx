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
  ACTION_LABELS,
  AGENT_ACTION_TYPES,
  slackDestinationOf,
  type AgentManifest,
  type SlackDestination,
} from "@/shared/team-agents";
import { AgentScope } from "./AgentScope";
import { SaveFooter, useRevise } from "./agentEditing";

type Props = { agentId: string; manifest: AgentManifest; canManage: boolean };

/**
 * The deployed version's permissions (the CRM's agent capabilities): where it
 * posts, what it can do there and what it can see. Its creator or an admin
 * changes them: taking something away goes live at once, and giving it more
 * makes a version to review and deploy.
 */
export function AgentCapabilities({ agentId, manifest, canManage }: Props) {
  const destination = slackDestinationOf(manifest);
  return (
    <>
      {destination ? (
        <LivesIn
          agentId={agentId}
          destination={destination}
          canManage={canManage}
        />
      ) : null}
      <WhatItCanDo
        agentId={agentId}
        manifest={manifest}
        canManage={canManage}
      />
      <AgentScope agentId={agentId} manifest={manifest} canManage={canManage} />
    </>
  );
}

/** The one Slack channel it posts to, and moving it to another. */
function LivesIn({
  agentId,
  destination,
  canManage,
}: {
  agentId: string;
  destination: SlackDestination;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const isChannel = destination.kind === "channel";
  const channels = useQuery({
    ...slackChannelsQueryOptions(""),
    enabled: isChannel,
  });
  const revise = useRevise(agentId, () => setPicked(null));
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
  const from = destination.label.replace(/^#/, "");
  const moving = picked !== null && picked.id !== destination.id;
  const editable = canManage && isChannel && channels.data !== undefined;

  return (
    <SettingsSection
      title="Lives in"
      description="One channel. The CRM joins it when you save."
      action={
        editable ? (
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
            className="rounded-none border-0"
            channels={channels.data.rows}
            canInviteItself={channels.data.canInviteItself}
            value={picked?.id ?? destination.id}
            pending={revise.isPending || join.isPending}
            onSelect={
              canManage
                ? (channel) => setPicked({ id: channel.id, name: channel.name })
                : undefined
            }
            onRequest={
              canManage ? (channel) => join.mutate(channel.id) : undefined
            }
          />
        ) : channels.isError ? (
          <SettingsRow
            label={destination.label}
            description="Slack isn't connected, so the channel can't be changed here."
          />
        ) : (
          <div className="px-5 py-4">
            <Skeleton className="h-5 w-40" />
          </div>
        )}
        {editable ? (
          <SaveFooter
            note={
              moving
                ? `The CRM joins #${picked.name}. It stays in #${from} until you remove it.`
                : null
            }
            dirty={moving}
            pending={revise.isPending}
            onDiscard={() => setPicked(null)}
            onSave={() => {
              if (picked) revise.mutate({ channel: picked });
            }}
          />
        ) : null}
      </SettingsCard>
      {creating ? (
        <CreateChannelDialog onClose={() => setCreating(false)} />
      ) : null}
    </SettingsSection>
  );
}

/** Its actions, each one it may take switched on or off. */
function WhatItCanDo({ agentId, manifest, canManage }: Props) {
  const [off, setOff] = useState<string[]>([]);
  const revise = useRevise(agentId, () => setOff([]));
  return (
    <SettingsSection
      title="What it can do there"
      description="If it is off here, it cannot do it."
    >
      <SettingsCard>
        {manifest.actions.map((action) => {
          const label = ACTION_LABELS[action.type] ?? action.type;
          return (
            <SettingsRow
              key={action.type}
              label={label}
              description={action.summary || action.provider}
            >
              <Switch
                checked={!off.includes(action.type)}
                disabled={
                  !canManage ||
                  revise.isPending ||
                  action.type === AGENT_ACTION_TYPES.RUN_SUMMARY
                }
                aria-label={`Allow: ${label}`}
                onCheckedChange={(on) =>
                  setOff((current) =>
                    on
                      ? current.filter((type) => type !== action.type)
                      : [...current, action.type],
                  )
                }
              />
            </SettingsRow>
          );
        })}
        {canManage ? (
          <SaveFooter
            note={
              off.length > 0 ? "The old version stays in the history." : null
            }
            dirty={off.length > 0}
            pending={revise.isPending}
            onDiscard={() => setOff([])}
            onSave={() =>
              revise.mutate({
                actions: manifest.actions
                  .map((action) => action.type)
                  .filter((type) => !off.includes(type)),
              })
            }
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
