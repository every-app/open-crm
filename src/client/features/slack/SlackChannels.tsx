import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { FormDialog } from "@/client/components/FormDialog";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import {
  createSlackChannel,
  joinSlackChannel,
  refreshSlack,
} from "@/serverFunctions/slack";
import { ChannelPicker } from "./ChannelPicker";
import { slackChannelsQueryOptions, slackKeys } from "./slackQueries";

/**
 * The channels the app can reach (the CRM's Slack channels section): search
 * them, add the app to one, read the list again, or create a channel.
 */
export function SlackChannels() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useDeferredValue(query);
  const channels = useQuery(slackChannelsQueryOptions(search));
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: slackKeys.all });
  const join = useMutation({
    mutationFn: (channelId: string) =>
      joinSlackChannel({ data: { channelId } }),
    onSuccess: async (result) => {
      if (result.outcome === "failed") toast.error(result.reason);
      else
        toast.success(
          result.outcome === "already"
            ? "The app is already in there."
            : result.outcome === "joined"
              ? "The app joined the channel."
              : "Ask someone in the channel to invite the app: /invite @your Slack app",
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
  const syncing = refresh.isPending || channels.data?.sync === "syncing";
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Channels the app can reach</h3>
          <p className="text-xs text-muted-foreground">
            Agents pick from this list.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          pending={syncing}
          onClick={() => refresh.mutate()}
        >
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          Create a channel
        </Button>
      </div>
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
      {channels.data?.sync === "stalled" ? (
        <p className="text-xs text-warning">
          Slack hasn't answered for a while. The list may be out of date.
        </p>
      ) : null}
      <QueryState
        query={channels}
        errorFallback="The channels could not be loaded."
      >
        {(data) => (
          <ChannelPicker
            channels={data.rows}
            canInviteItself={data.canInviteItself}
            pending={join.isPending}
            onAdd={(channel) => join.mutate(channel.id)}
            empty={
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {syncing
                  ? "Reading the channel list from Slack…"
                  : query
                    ? `No channel matches "${query}".`
                    : "No channels yet. The CRM reads them from Slack after it connects."}
              </p>
            }
          />
        )}
      </QueryState>
      {creating ? (
        <CreateChannelDialog onClose={() => setCreating(false)} />
      ) : null}
    </section>
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
            Create channel
          </Button>
        </>
      }
    >
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
              : `Slack will call it #${slug || "renewals"}. The app makes it and joins it.`}
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
