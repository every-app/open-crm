import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sortBy } from "remeda";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import {
  COPY,
  SOURCES,
  mailboxState,
  type Connection,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { connectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { DangerRow, DangerZone } from "@/client/features/settings/DangerZone";
import {
  ConnectionBadge,
  TitleWithStatus,
} from "@/client/features/settings/ConnectionStatus";
import type { MailboxProvider, SyncSource } from "@/shared/mailbox";
import {
  checkConnectionNow,
  disconnectMailbox,
  purgeSyncedData,
  setConnectionAutoCreate,
  startConnect,
} from "@/serverFunctions/mailbox";

// A member's connected mailbox: how each source is doing, Check now, the
// auto-create switches, and in the Danger zone deleting what it brought in
// and disconnecting.

// A Google error's "Resolve" link goes to Google only.
const RESOLVE_HOSTS = [
  "console.cloud.google.com",
  "console.developers.google.com",
  "support.google.com",
  "myaccount.google.com",
];

function resolveLink(error: string): string | undefined {
  const found = error.match(/https?:\/\/[^\s)]+/)?.[0];
  if (!found) return undefined;
  try {
    const url = new URL(found);
    const allowed =
      url.protocol === "https:" &&
      RESOLVE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      );
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** A sync error as the alert shows it: its first sentence, and where to fix it. */
function explain(provider: MailboxProvider, error: string) {
  if (provider !== "google") return { summary: error, url: undefined };
  return {
    summary: error.split(/(?<=\.)\s/)[0] ?? error,
    url: resolveLink(error),
  };
}

type Source = Connection["sources"][number];

const failingSource = (source: Source) =>
  source.granted &&
  (source.status === "NEEDS_RECONNECT" || source.lastError !== null);

/** Which sources fail and why, to tell a failure Check now didn't change. */
function failureSignature(sources: readonly Source[]): string {
  return sortBy(
    sources
      .filter(failingSource)
      .map((source) => `${source.source}:${source.lastError ?? "reconnect"}`),
    (failure) => failure,
  ).join("|");
}

/** Sends the member to the provider's consent page. */
export function useConnect(provider: MailboxProvider) {
  return useMutation({
    mutationFn: () => startConnect({ data: { provider } }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function ConnectedMailbox({
  status,
  connection,
}: {
  status: ProviderStatus;
  connection: Connection;
}) {
  const { provider } = status;
  const copy = COPY[provider];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const connect = useConnect(provider);
  const [confirming, setConfirming] = useState<"purge" | "revoke" | null>(null);
  // Bumped when Check now comes back with the same failure, so the alert
  // shows it heard.
  const [insistence, setInsistence] = useState(0);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: connectionsQueryOptions().queryKey,
    });

  const checkNow = useMutation({
    mutationFn: () => checkConnectionNow({ data: { provider } }),
    onSuccess: async () => {
      const before = failureSignature(connection.sources);
      await refresh();
      const after = queryClient
        .getQueryData(connectionsQueryOptions().queryKey)
        ?.providers.find((entry) => entry.provider === provider)
        ?.connection?.sources;
      const now = failureSignature(after ?? []);
      if (now && now === before) setInsistence((count) => count + 1);
    },
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
  const revoke = useMutation({
    mutationFn: () => disconnectMailbox({ data: { provider } }),
    onSuccess: async () => {
      await refresh();
      toast.success(`${copy.name} disconnected.`);
      await navigate({ to: "/settings/connections" });
    },
    onSettled: () => setConfirming(null),
  });

  const failing = connection.sources.filter(failingSource);
  const lastSyncedAt = connection.sources.reduce<string | null>(
    (latest, source) =>
      source.lastSyncedAt && (!latest || source.lastSyncedAt > latest)
        ? source.lastSyncedAt
        : latest,
    null,
  );
  const syncing = connection.sources.some((source) => source.syncing);
  const quiet = connection.hasRefreshToken && failing.length === 0;
  const attention =
    insistence > 0 ? "animate-in fade-in-0 zoom-in-95 duration-300" : "";

  return (
    <>
      <SettingsSection
        title={
          <TitleWithStatus
            status={<ConnectionBadge state={mailboxState(status)} />}
          >
            {copy.name}
          </TitleWithStatus>
        }
        description={copy.connected}
        action={
          connection.needsReconnect ? (
            <Button
              pending={connect.isPending}
              disabled={!status.ready}
              onClick={() => connect.mutate()}
            >
              Reconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              pending={checkNow.isPending || syncing}
              onClick={() => checkNow.mutate()}
            >
              {checkNow.isPending || syncing ? "Checking…" : "Check now"}
            </Button>
          )
        }
      >
        {!connection.hasRefreshToken ? (
          <Alert key={insistence} variant="destructive" className={attention}>
            <TriangleAlert aria-hidden />
            <AlertTitle>{copy.name} did not return a refresh token</AlertTitle>
            <AlertDescription>Disconnect and connect again.</AlertDescription>
          </Alert>
        ) : (
          failing.map((source) => {
            const { summary, url } = explain(
              provider,
              source.lastError ?? `${copy.name} needs reconnecting.`,
            );
            return (
              <Alert
                key={`${source.source}-${insistence}`}
                variant="destructive"
                className={attention}
              >
                <TriangleAlert aria-hidden />
                <AlertTitle>
                  {SOURCES[source.source].label} sync failed
                </AlertTitle>
                <AlertDescription>{summary}</AlertDescription>
                {url ? (
                  <AlertAction>
                    <Button
                      variant="outline"
                      size="xs"
                      nativeButton={false}
                      render={<a href={url} target="_blank" rel="noreferrer" />}
                    >
                      Resolve
                      <ExternalLink data-icon="inline-end" aria-hidden />
                    </Button>
                  </AlertAction>
                ) : null}
              </Alert>
            );
          })
        )}
        <SettingsCard>
          <SettingsRow
            label={connection.accountEmail}
            description={
              quiet ? (
                lastSyncedAt ? (
                  <>
                    Last checked <RelativeTime date={lastSyncedAt} />
                  </>
                ) : (
                  "Waiting for the first check"
                )
              ) : undefined
            }
          >
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={copy.manage} target="_blank" rel="noreferrer" />}
            >
              {copy.manageLabel}
              <ExternalLink data-icon="inline-end" aria-hidden />
            </Button>
          </SettingsRow>
          {connection.sources.map((source) => {
            const sourceCopy = SOURCES[source.source];
            const id = `auto-create-${source.source}`;
            return (
              <SettingsRow
                key={source.source}
                label={sourceCopy.label}
                htmlFor={source.granted ? id : undefined}
                description={
                  source.granted ? sourceCopy.autoCreate : "Not granted"
                }
              >
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
                    variant="outline"
                    pending={connect.isPending}
                    disabled={!status.ready}
                    onClick={() => connect.mutate()}
                  >
                    Allow
                  </Button>
                )}
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </SettingsSection>

      <DangerZone>
        <DangerRow
          label="Delete synced data"
          description={copy.purged}
          action="Delete"
          pending={purge.isPending}
          onClick={() => setConfirming("purge")}
        />
        <DangerRow
          label={copy.revoke}
          description={copy.stops}
          action={copy.revokeAction}
          pending={revoke.isPending}
          onClick={() => setConfirming("revoke")}
        />
      </DangerZone>

      {confirming === "purge" ? (
        <ConfirmDialog
          title="Delete synced data?"
          confirmLabel="Delete"
          destructive
          pending={purge.isPending}
          onConfirm={() => purge.mutate()}
          onClose={() => setConfirming(null)}
        >
          {copy.purged} The next check starts from now, so nothing deleted here
          comes back.
        </ConfirmDialog>
      ) : null}
      {confirming === "revoke" ? (
        <ConfirmDialog
          title={`${copy.revoke}?`}
          confirmLabel={copy.revokeAction}
          destructive
          pending={revoke.isPending}
          onConfirm={() => revoke.mutate()}
          onClose={() => setConfirming(null)}
        >
          {copy.revoked}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
