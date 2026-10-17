import { useDeferredValue, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Hash, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { FormDialog } from "@/client/components/FormDialog";
import { QueryError } from "@/client/components/QueryState";
import { SettingsSection } from "@/client/components/SettingsSection";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { DialogDescription } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { useCopy } from "@/client/hooks/useCopy";
import { CodeBlock } from "@/client/features/settings/CodeBlock";
import {
  createSlackChannel,
  joinSlackChannel,
  refreshSlack,
} from "@/serverFunctions/slack";
import { ChannelPicker, type PickerChannel } from "./ChannelPicker";
import { slackChannelPagesQueryOptions, slackKeys } from "./slackQueries";

/**
 * The channels the app can reach (the CRM's Slack channels section): search
 * them, add the app to one or ask for it, read the list again, or create a
 * channel.
 */
export function SlackChannels({ appName }: { appName: string | null }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState<PickerChannel | null>(null);
  const search = useDeferredValue(query.trim());
  const channels = useInfiniteQuery(slackChannelPagesQueryOptions(search));
  const first = channels.data?.pages[0];
  const rows = channels.data?.pages.flatMap((page) => page.rows) ?? [];
  const canInviteItself = first?.canInviteItself ?? false;
  const subject = appName ?? "The app";
  const object = appName ?? "the app";
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: slackKeys.all });

  const join = useMutation({
    mutationFn: (channelId: string) =>
      joinSlackChannel({ data: { channelId } }),
    onSuccess: async (result) => {
      setAsking(null);
      if (result.outcome === "failed") toast.error(result.reason);
      else
        toast.success(
          result.outcome === "already"
            ? `${subject} is already in there.`
            : result.outcome === "joined"
              ? `${subject} joined the channel.`
              : `Ask someone inside to invite ${object}.`,
        );
      await invalidate();
    },
  });
  const refresh = useMutation({
    mutationFn: () => refreshSlack(),
    onSuccess: async () => {
      toast.success("Reading the channel list from Slack.");
      await invalidate();
    },
  });
  const refreshing = refresh.isPending || first?.sync === "syncing";

  return (
    <SettingsSection
      title={`Channels ${object} can reach`}
      description="Agents pick from this list."
      action={
        <>
          <Button
            variant="outline"
            pending={refreshing}
            onClick={() => refresh.mutate()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="outline" onClick={() => setCreating(true)}>
            Create a channel
          </Button>
        </>
      }
    >
      {first?.sync === "stalled" ? (
        <p className="text-sm text-warning">
          The CRM is not reading Slack right now. The list can be out of date.
        </p>
      ) : null}
      {rows.length > 0 || query ? (
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
          />
        </InputGroup>
      ) : null}
      {channels.isError ? (
        <QueryError
          error={channels.error}
          fallback="The channels could not be loaded."
          onRetry={() => void channels.refetch()}
          isRetrying={channels.isFetching}
        />
      ) : null}
      {channels.isPending ? (
        <SkeletonCard />
      ) : channels.data ? (
        <ChannelPicker
          channels={rows}
          canInviteItself={canInviteItself}
          appName={appName}
          pending={join.isPending}
          onAdd={(channel) => join.mutate(channel.id)}
          onRequest={setAsking}
          empty={
            refreshing ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Reading the channel list from Slack…
              </p>
            ) : search ? (
              <EmptyState
                kind="filtered"
                variant="plain"
                size="sm"
                title={`No channel matches “${search}”.`}
              />
            ) : (
              <EmptyState
                icon={Hash}
                media="rows"
                variant="plain"
                title="No channels yet"
                description="The CRM reads the list from Slack after it connects."
              />
            )
          }
        />
      ) : null}
      {channels.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          pending={channels.isFetchingNextPage}
          onClick={() => void channels.fetchNextPage()}
        >
          {channels.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
      {asking ? (
        <AskDialog
          channel={asking}
          appName={appName}
          canInviteItself={canInviteItself}
          pending={join.isPending}
          onCancel={() => setAsking(null)}
          onConfirm={() => join.mutate(asking.id)}
        />
      ) : null}
      {creating ? (
        <CreateChannelDialog onClose={() => setCreating(false)} />
      ) : null}
    </SettingsSection>
  );
}

/**
 * A private channel the app isn't in: with the installer's grant it joins
 * as them, which the channel sees; without it someone inside runs the
 * invite, and the channel is marked as asked.
 */
function AskDialog({
  channel,
  appName,
  canInviteItself,
  pending,
  onCancel,
  onConfirm,
}: {
  channel: PickerChannel;
  appName: string | null;
  canInviteItself: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { copy } = useCopy();
  const subject = appName ?? "The app";
  const object = appName ?? "the app";
  const command = appName ? `/invite @${appName}` : null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {canInviteItself
              ? `Add ${object} to #${channel.name}?`
              : `Ask someone to add ${object}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {canInviteItself
              ? `It is a private channel, so ${object} joins as you. Same as typing the invite yourself. Everyone in the channel sees it join. It reads nothing until you turn a permission on.`
              : `We cannot add ${object} to a private channel yet. Someone already in #${channel.name} has to ${command ? "run this" : "invite it"}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!canInviteItself && command ? (
          <CodeBlock value={command} successMessage="Command copied." />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {canInviteItself ? (
            <Button pending={pending} onClick={onConfirm}>
              {pending ? "Adding…" : `Add ${subject}`}
            </Button>
          ) : (
            <Button
              pending={pending}
              onClick={() => {
                if (!command) return onConfirm();
                void copy(command, "Command copied.").then((copied) => {
                  if (copied) onConfirm();
                });
              }}
            >
              {command ? "Copy and mark as asked" : "Mark as asked"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
  const valid = /^[a-z0-9_-]+$/.test(slug);
  const create = useMutation({
    mutationFn: () => createSlackChannel({ data: { name: slug, isPrivate } }),
    onSuccess: async (result) => {
      if (!result.created) {
        toast.error(result.reason);
        return;
      }
      toast.success(`Created #${result.channel.name}.`);
      await queryClient.invalidateQueries({ queryKey: slackKeys.all });
      onClose();
    },
  });
  return (
    <FormDialog
      title="Create a channel"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!valid}
            pending={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create channel"}
          </Button>
        </>
      }
    >
      <DialogDescription>
        The CRM makes it in Slack and joins it. You can put the agent in it
        straight after.
      </DialogDescription>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={name}
            placeholder="renewals"
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {slug && !valid
              ? "Use lowercase letters, numbers and dashes."
              : `Slack will call it #${slug || "renewals"}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="channel-private"
            checked={isPrivate}
            onCheckedChange={setIsPrivate}
          />
          <Label htmlFor="channel-private">
            Private. Only people you invite can see it.
          </Label>
        </div>
      </div>
    </FormDialog>
  );
}
