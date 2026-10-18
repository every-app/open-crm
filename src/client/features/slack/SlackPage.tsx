import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Alert, AlertAction, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { ConnectionBadge } from "@/client/features/settings/ConnectionStatus";
import { DangerRow, DangerZone } from "@/client/features/settings/DangerZone";
import { disconnectSlack, type getSlackStatus } from "@/serverFunctions/slack";
import {
  describeSlackScopes,
  SLACK_USER_GRANT,
  type SlackConnectError,
} from "@/shared/slack";
import { SlackChannels } from "./SlackChannels";
import {
  SlackConnectAlert,
  SlackNotConnected,
  useSlackConnect,
} from "./SlackNotConnected";
import { ScopeGroups } from "./SlackScopeGroups";
import { slackKeys, slackStatusQueryOptions } from "./slackQueries";

type Status = Awaited<ReturnType<typeof getSlackStatus>>;

/** Withheld grants that keep the app out of private channels. */
const PRIVATE_CHANNEL_SCOPES = new Set<string>([
  "groups:read",
  "groups:history",
  SLACK_USER_GRANT.scope,
]);

/**
 * Settings → Connections → Slack (the CRM's Slack page): what connecting
 * hands over, and once connected what the workspace granted, the channels
 * the app can reach, the agents that use Slack and who is matched.
 */
export function SlackPage({
  connectError,
}: {
  connectError?: SlackConnectError;
}) {
  const status = useQuery(slackStatusQueryOptions());
  if (status.data) {
    return status.data.connected ? (
      <Connected status={status.data} connectError={connectError} />
    ) : (
      <SlackNotConnected status={status.data} connectError={connectError} />
    );
  }
  return (
    <SettingsPage title="Slack">
      <QueryState
        query={status}
        errorFallback="Slack's status could not be loaded."
      >
        {() => null}
      </QueryState>
    </SettingsPage>
  );
}

function Connected({
  status,
  connectError,
}: {
  status: Extract<Status, { connected: true }>;
  /** A reconnect that came back without Slack. */
  connectError?: SlackConnectError;
}) {
  const queryClient = useQueryClient();
  const reconnect = useSlackConnect();
  const [confirming, setConfirming] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => disconnectSlack(),
    onSuccess: async () => {
      setConfirming(false);
      toast.success("Slack disconnected.");
      await queryClient.invalidateQueries({ queryKey: slackKeys.all });
    },
  });
  const app = status.appName ?? "The app";
  const withheld = [
    ...describeSlackScopes(status.missing),
    ...(status.canInviteItself ? [] : [SLACK_USER_GRANT]),
  ];
  const privateChannels = withheld.some((entry) =>
    PRIVATE_CHANNEL_SCOPES.has(entry.scope),
  );
  const { people } = status;

  return (
    <SettingsPage
      title="Slack"
      actions={
        // Level with the title's line.
        <span className="flex h-8 items-center">
          <ConnectionBadge
            state="connected"
            label={
              status.workspace ? `Connected to ${status.workspace}` : undefined
            }
          />
        </span>
      }
    >
      {connectError || withheld.length > 0 || status.syncError ? (
        <div className="space-y-3">
          <SlackConnectAlert error={connectError} />
          {withheld.length > 0 ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>
                {privateChannels
                  ? `${app} cannot reach private channels`
                  : `Slack held back ${withheld.length} permission${withheld.length === 1 ? "" : "s"}`}
              </AlertTitle>
              {status.canManage ? (
                <AlertAction>
                  <Button
                    variant="outline"
                    size="xs"
                    pending={reconnect.isPending}
                    onClick={() => reconnect.mutate()}
                  >
                    {reconnect.isPending ? "Opening Slack…" : "Reconnect"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}
          {status.syncError ? (
            <p className="text-sm text-warning">{status.syncError}</p>
          ) : null}
        </div>
      ) : null}

      <ScopeGroups
        title="What this workspace granted"
        scopes={status.scopes}
        withheld={withheld}
      />
      <SlackChannels appName={status.appName} />

      <SettingsSection
        title="Agents that use Slack"
        action={
          <Button
            nativeButton={false}
            render={<Link to="/chat" state={{ builderDraft: "" }} />}
          >
            New agent
          </Button>
        }
      >
        {status.agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            media="rows"
            variant="card"
            title="No deployed agents use Slack yet"
          />
        ) : (
          <SettingsCard>
            {status.agents.map((agent) => (
              <Link
                key={agent.id}
                to="/agents/$agentId"
                params={{ agentId: agent.id }}
                className="flex items-center gap-4 px-5 py-4 outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03]"
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium">
                    {agent.name}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {agent.description ?? `Posts to ${agent.destination}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className={
                      agent.status === "LIVE"
                        ? "size-2 rounded-full bg-success"
                        : "size-2 rounded-full bg-muted-foreground"
                    }
                  />
                  {agent.status === "LIVE" ? "Running" : "Paused"}
                </span>
              </Link>
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <SettingsSection title="People">
        <SettingsCard>
          <SettingsRow
            label={
              people.reviewed === 0
                ? "Not reviewed yet"
                : `${people.matched} of ${people.reviewed} matched`
            }
          >
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/settings/connections/slack/people" />}
            >
              Review
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {status.canManage ? (
        <DangerZone>
          <DangerRow
            label="Disconnect Slack"
            description="Agents stop sending to Slack immediately."
            action="Disconnect"
            pending={disconnect.isPending}
            onClick={() => setConfirming(true)}
          />
        </DangerZone>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`Disconnect ${status.workspace ?? "Slack"}?`}
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </SettingsPage>
  );
}
