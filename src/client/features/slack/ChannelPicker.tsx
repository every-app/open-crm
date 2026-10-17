import { Check, Lock } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";

type PickerChannel = {
  id: string;
  name: string;
  memberCount: number | null;
  isPrivate: boolean;
  isMember: boolean;
  classified: boolean;
  inviteRequestedAt: string | null;
};

/**
 * The Slack channels the app can reach (the CRM's channel picker): which it
 * is in, which it can join, and which need someone inside to invite it.
 */
export function ChannelPicker({
  channels,
  canInviteItself,
  empty,
  value = null,
  pending = false,
  onSelect,
  onAdd,
  onRequest = onAdd,
  className,
}: {
  channels: PickerChannel[];
  canInviteItself: boolean;
  empty?: React.ReactNode;
  value?: string | null;
  pending?: boolean;
  onSelect?: (channel: PickerChannel) => void;
  onAdd?: (channel: PickerChannel) => void;
  /** Asks for the app to be invited to a private channel; `onAdd` by default. */
  onRequest?: (channel: PickerChannel) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      {channels.length === 0 ? empty : null}
      {channels.map((channel) => {
        const selected = value === channel.id;
        const needsInvite =
          channel.isPrivate && !channel.isMember && !canInviteItself;
        return (
          <div
            key={channel.id}
            className={cn(
              "relative flex h-14 items-center gap-3 px-4",
              selected && "bg-muted",
              onSelect && !needsInvite && "hover:bg-muted/50",
            )}
          >
            {onSelect && !needsInvite ? (
              <button
                type="button"
                className="absolute inset-0"
                aria-label={`Choose #${channel.name}`}
                aria-pressed={selected}
                disabled={pending}
                onClick={() => onSelect(channel)}
              />
            ) : null}
            <span className="flex w-5 justify-center text-muted-foreground">
              {channel.isPrivate ? <Lock className="size-3.5" /> : "#"}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  !channel.isMember && !selected && "text-muted-foreground",
                )}
              >
                {channel.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {describe(channel, canInviteItself)}
              </span>
            </span>
            <span className="relative flex w-24 justify-end">
              {selected || (value === null && channel.isMember) ? (
                <Check className="size-4 text-success" />
              ) : needsInvite && onRequest ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => onRequest(channel)}
                >
                  {channel.inviteRequestedAt ? "Ask again" : "Request"}
                </Button>
              ) : !channel.isMember && onAdd ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => onAdd(channel)}
                >
                  Add
                </Button>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function describe(channel: PickerChannel, canInviteItself: boolean): string {
  const people =
    channel.memberCount === null ? "" : ` · ${channel.memberCount} people`;
  if (channel.isMember) return `The app is in${people}`;
  if (!channel.classified) return `Not read from Slack yet${people}`;
  if (!channel.isPrivate) return `The app can join this one${people}`;
  if (canInviteItself) return `Private. The app joins as you${people}`;
  if (channel.inviteRequestedAt)
    return `Private. Waiting on an invite${people}`;
  return `Private. Someone inside has to invite the app${people}`;
}
