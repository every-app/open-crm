import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Switch } from "@/client/components/ui/switch";
import {
  COPY,
  SOURCES,
  type Connection,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { formatRelativeTime } from "@/client/lib/relative-time";
import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import {
  checkConnectionNow,
  disconnectMailbox,
  purgeSyncedData,
  setConnectionAutoCreate,
  startConnect,
} from "@/serverFunctions/mailbox";

// A member's connected mailbox: how each source is doing, Check now, the
// auto-create switches, Delete synced data and Disconnect.

/** Sends the member to the provider's consent page. */
export function useConnect(provider: MailboxProvider) {
  return useMutation({
    mutationFn: () => startConnect({ data: { provider } }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function ConnectedCard({
  status,
  connection,
}: {
  status: ProviderStatus;
  connection: Connection;
}) {
  const { provider } = status;
  const copy = COPY[provider];
  const queryClient = useQueryClient();
  const connect = useConnect(provider);
  const [confirming, setConfirming] = useState<"purge" | "disconnect" | null>(
    null,
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["mailbox", "connections"] });

  const checkNow = useMutation({
    mutationFn: () => checkConnectionNow({ data: { provider } }),
    onSettled: refresh,
  });
  const autoCreate = useMutation({
    mutationFn: (input: { source: SyncSource; enabled: boolean }) =>
      setConnectionAutoCreate({ data: input }),
    onSettled: refresh,
  });
  const purge = useMutation({
    mutationFn: () => purgeSyncedData({ data: { provider } }),
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
  const disconnect = useMutation({
    mutationFn: () => disconnectMailbox({ data: { provider } }),
    onSuccess: async () => {
      await refresh();
      toast.success(`${copy.name} disconnected.`);
    },
    onSettled: () => setConfirming(null),
  });

  const needsReconnect =
    connection.needsReconnect ||
    connection.sources.some((source) => source.status === "NEEDS_RECONNECT");
  const failing = connection.sources.filter(
    (source) => source.granted && source.lastError,
  );
  const lastSyncedAt = connection.sources.reduce<string | null>(
    (latest, source) =>
      source.lastSyncedAt && (!latest || source.lastSyncedAt > latest)
        ? source.lastSyncedAt
        : latest,
    null,
  );
  const healthy =
    !needsReconnect && failing.length === 0 && connection.hasRefreshToken;
  const syncing = connection.sources.some((source) => source.syncing);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {copy.name}
          {healthy ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Badge variant="warning">Needs attention</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {copy.connected}{" "}
          <span className="text-foreground">{connection.accountEmail}</span>
        </CardDescription>
        <CardAction>
          {needsReconnect ? (
            <Button
              size="sm"
              pending={connect.isPending}
              onClick={() => connect.mutate()}
              disabled={!status.ready}
            >
              Reconnect
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              pending={checkNow.isPending || syncing}
              onClick={() => checkNow.mutate()}
            >
              {checkNow.isPending || syncing ? "Checking…" : "Check now"}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {needsReconnect ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{copy.name} needs reconnecting</AlertTitle>
            <AlertDescription>
              {copy.name} stopped accepting the CRM's access, so nothing new is
              coming in. Reconnect to pick up from here.
            </AlertDescription>
          </Alert>
        ) : !connection.hasRefreshToken ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{copy.name} did not return a refresh token</AlertTitle>
            <AlertDescription>
              Capture stops when the current access expires. Disconnect and
              connect again.
            </AlertDescription>
          </Alert>
        ) : failing.length > 0 ? (
          failing.map((source) => (
            <Alert key={source.source} variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>
                {SOURCES[source.source].label} sync failed
              </AlertTitle>
              <AlertDescription>{source.lastError}</AlertDescription>
            </Alert>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            {lastSyncedAt
              ? `Last checked ${formatRelativeTime(lastSyncedAt)}`
              : "Waiting for the first check"}
          </p>
        )}

        <div className="divide-y divide-border">
          {connection.sources.map((source) => {
            const sourceCopy = SOURCES[source.source];
            const id = `auto-create-${source.source}`;
            return (
              <div
                key={source.source}
                className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0"
              >
                <label htmlFor={id} className="flex flex-col gap-1">
                  <span className="text-sm">{sourceCopy.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {source.granted
                      ? sourceCopy.autoCreate
                      : `Not granted: connect again and allow ${sourceCopy.label.toLowerCase()} to bring it in.`}
                  </span>
                </label>
                {source.granted ? (
                  <Switch
                    id={id}
                    checked={source.autoCreate}
                    disabled={autoCreate.isPending}
                    onCheckedChange={(enabled) =>
                      autoCreate.mutate({ source: source.source, enabled })
                    }
                  />
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    pending={connect.isPending}
                    disabled={!status.ready}
                    onClick={() => connect.mutate()}
                  >
                    Allow
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setConfirming("purge")}
        >
          Delete synced data
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setConfirming("disconnect")}
        >
          Disconnect {copy.name}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          nativeButton={false}
          render={<a href={copy.manage} target="_blank" rel="noreferrer" />}
        >
          {copy.manageLabel}
          <ExternalLink data-icon="inline-end" aria-hidden />
        </Button>
      </CardFooter>
      {confirming === "purge" ? (
        <ConfirmDialog
          title="Delete synced data?"
          confirmLabel="Delete"
          destructive
          pending={purge.isPending}
          onConfirm={() => purge.mutate()}
          onClose={() => setConfirming(null)}
        >
          {copy.purged} from the CRM. The next check starts from now, so nothing
          deleted here comes back.
        </ConfirmDialog>
      ) : null}
      {confirming === "disconnect" ? (
        <ConfirmDialog
          title={`Disconnect ${copy.name}?`}
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirming(null)}
        >
          {copy.disconnect}
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
