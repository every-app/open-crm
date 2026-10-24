import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { QueryError } from "@/client/components/QueryState";
import { RowActionsMenu } from "@/client/components/RowActionsMenu";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import { COPY, mailboxState } from "@/client/features/mailbox/connectionCopy";
import { memberConnectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import {
  ConnectionBadge,
  type ConnectionState,
} from "@/client/features/settings/ConnectionStatus";
import {
  GoogleLogo,
  MicrosoftLogo,
} from "@/client/features/settings/brandLogos";
import type { MemberMailboxes as MemberMailboxList } from "@/server/features/mailbox/services/MemberMailboxService";
import { disconnectMailbox, purgeSyncedData } from "@/serverFunctions/mailbox";

// Settings → Connections for owners and admins: every member's mailbox, to
// delete what one synced or disconnect it, as for a member who left. Absent
// until somebody connects one.

type Entry = MemberMailboxList[number];

const LOGOS = { google: GoogleLogo, microsoft: MicrosoftLogo } as const;

function stateOf({ connection }: Entry): ConnectionState {
  if (connection.sources.some((source) => source.status === "PAUSED")) {
    return "paused";
  }
  return mailboxState({ ready: true, connection });
}

export function MemberMailboxes() {
  const query = useQuery(memberConnectionsQueryOptions());
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<{
    action: "purge" | "revoke";
    entry: Entry;
  } | null>(null);

  const purge = useMutation({
    mutationFn: ({ userId, provider }: Entry) =>
      purgeSyncedData({ data: { userId, provider } }),
    onSuccess: async ({ purged }) => {
      // Timelines and last-activity times moved everywhere.
      await queryClient.invalidateQueries();
      toast.success(
        purged === 1
          ? "Removed 1 synced item."
          : `Removed ${purged} synced items.`,
      );
    },
    onSettled: () => setConfirming(null),
  });
  const revoke = useMutation({
    mutationFn: ({ userId, provider }: Entry) =>
      disconnectMailbox({ data: { userId, provider } }),
    onSuccess: async (_, { provider }) => {
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      toast.success(`${COPY[provider].name} disconnected.`);
    },
    onSettled: () => setConfirming(null),
  });

  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        fallback="The members' mailboxes could not be loaded."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (!query.data?.length) return null;

  const pending = confirming
    ? confirming.action === "purge"
      ? purge.isPending
      : revoke.isPending
    : false;

  return (
    <SettingsSection title="Members' mailboxes">
      <SettingsCard>
        {query.data.map((entry) => {
          const Logo = LOGOS[entry.provider];
          const copy = COPY[entry.provider];
          return (
            <SettingsRow
              key={`${entry.userId}-${entry.provider}`}
              label={
                <span className="flex items-center gap-2.5">
                  <Logo className="size-4 shrink-0" />
                  {entry.name}
                </span>
              }
              description={entry.connection.accountEmail}
            >
              <ConnectionBadge state={stateOf(entry)} />
              <RowActionsMenu
                label={`Actions for ${entry.name}'s ${copy.name}`}
              >
                <DropdownMenuItem
                  onClick={() => setConfirming({ action: "purge", entry })}
                >
                  Delete synced data
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirming({ action: "revoke", entry })}
                >
                  {copy.revoke}
                </DropdownMenuItem>
              </RowActionsMenu>
            </SettingsRow>
          );
        })}
      </SettingsCard>

      {confirming ? (
        <ConfirmDialog
          title={
            confirming.action === "purge"
              ? `Delete ${confirming.entry.name}'s synced data?`
              : `${COPY[confirming.entry.provider].revoke} for ${confirming.entry.name}?`
          }
          confirmLabel={
            confirming.action === "purge"
              ? "Delete"
              : COPY[confirming.entry.provider].revokeAction
          }
          destructive
          pending={pending}
          onConfirm={() =>
            confirming.action === "purge"
              ? purge.mutate(confirming.entry)
              : revoke.mutate(confirming.entry)
          }
          onClose={() => setConfirming(null)}
        >
          {confirming.action === "purge"
            ? "Nothing deleted here comes back."
            : null}
        </ConfirmDialog>
      ) : null}
    </SettingsSection>
  );
}
