import type { ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";

export type PickerChannel = {
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
 * `onRequest` takes a private channel the app isn't in yet; without it,
 * `onAdd` takes every channel it isn't in.
 */
export function ChannelPicker({
  channels,
  canInviteItself,
  appName = null,
  empty,
  value = null,
  pending = false,
  onSelect,
  onAdd,
  onRequest,
  className,
}: {
  channels: PickerChannel[];
  canInviteItself: boolean;
  /** The app's name in the workspace, once Slack has said it. */
  appName?: string | null;
  empty?: ReactNode;
  value?: string | null;
  pending?: boolean;
  onSelect?: (channel: PickerChannel) => void;
  onAdd?: (channel: PickerChannel) => void;
  /** Joins, or asks to be invited to, a private channel the app isn't in. */
  onRequest?: (channel: PickerChannel) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs",
        className,
      )}
    >
      {channels.length === 0 ? empty : null}
      {channels.map((channel) => {
        const selected = value === channel.id;
        const needsInvite =
          channel.isPrivate && !channel.isMember && !canInviteItself;
        const request =
          channel.isPrivate && !channel.isMember && onRequest
            ? onRequest
            : null;
        return (
          <div
            key={channel.id}
            className={cn(
              "relative flex h-14 items-center gap-3 px-4",
              selected && "bg-foreground/[0.05]",
              onSelect && !needsInvite && "hover:bg-foreground/[0.03]",
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
              <span className="block truncate text-xs text-muted-foreground">
                {describe(channel, canInviteItself, appName)}
              </span>
            </span>
            <span className="relative flex w-24 justify-end">
              {selected || (value === null && channel.isMember) ? (
                <Check className="size-4 text-success" />
              ) : request ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => request(channel)}
                >
                  {canInviteItself
                    ? "Add"
                    : channel.inviteRequestedAt
                      ? "Ask again"
                      : "Request"}
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

function describe(
  channel: PickerChannel,
  canInviteItself: boolean,
  appName: string | null,
): string {
  const people =
    channel.memberCount === null ? "" : ` · ${channel.memberCount} people`;
  // The app's name when Slack has said it, as a sentence's subject or object.
  const subject = appName ?? "The app";
  const object = appName ?? "the app";
  if (channel.isMember) return `${subject} is in${people}`;
  if (!channel.classified) return `Not read from Slack yet${people}`;
  if (!channel.isPrivate) return `${subject} can join this one${people}`;
  if (canInviteItself) return `Private. ${subject} joins as you${people}`;
  if (channel.inviteRequestedAt)
    return `Private. Waiting on an invite${people}`;
  return `Private. Someone inside has to invite ${object}${people}`;
}
