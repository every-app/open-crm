import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { CopyButton } from "@/client/components/CopyButton";
import { QueryState } from "@/client/components/QueryState";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import {
  disconnectSlack,
  startSlackConnect,
  type getSlackStatus,
} from "@/serverFunctions/slack";
import {
  describeSlackScopes,
  SLACK_BOT_SCOPES,
  SLACK_USER_GRANT,
} from "@/shared/slack";
import { SlackChannels } from "./SlackChannels";
import { SlackPeople } from "./SlackPeople";
import { ScopeGroups } from "./SlackScopeGroups";
import { slackKeys, slackStatusQueryOptions } from "./slackQueries";

type Status = Awaited<ReturnType<typeof getSlackStatus>>;

const NEVER = [
  "Send anything at all until you build an agent and deploy it",
  "Post anywhere except the destination approved in that agent",
  "Read a direct message between two people",
];

/** Why a connect came back without Slack, from the callback's outcome. */
const CONNECT_OUTCOMES: Record<string, string> = {
  access_denied: "Slack installation was cancelled before access was granted.",
  invalid_state:
    "That Slack approval expired or was started by someone else. Start again.",
  forbidden: "Only an owner or an admin can connect Slack.",
  exchange_failed:
    "Slack refused the gateway's app credentials or redirect URL. Check the Slack app's OAuth settings, then try again.",
  not_configured: "Slack isn't set up on this gateway.",
  rejected: "Slack didn't finish the installation. Try again.",
  failed: "Slack could not be connected. Try again.",
};

/**
 * Settings → Connections → Slack (the CRM's Slack connection page): whether
 * the gateway offers Slack, what connecting hands over, and once connected
 * what the workspace granted, the channels the app can reach, the members it
 * matched and the agents that post there.
 */
export function SlackCard({ outcome }: { outcome?: string }) {
  const status = useQuery(slackStatusQueryOptions());
  return (
    <section className="space-y-3">
      {outcome === "connected" ? (
        <Alert variant="success">
          <Check />
          <AlertTitle>Slack is connected</AlertTitle>
          <AlertDescription>
            The CRM is reading its people and channels now.
          </AlertDescription>
        </Alert>
      ) : outcome ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Slack wasn't connected</AlertTitle>
          <AlertDescription>
            {CONNECT_OUTCOMES[outcome] ?? CONNECT_OUTCOMES.failed}
          </AlertDescription>
        </Alert>
      ) : null}
      <QueryState
        query={status}
        errorFallback="Slack's status could not be loaded."
      >
        {(data) => (
          <Card className="max-w-3xl">
            <CardContent className="space-y-6">
              <header className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-medium">Slack</h2>
                <Badge
                  variant={
                    data.connected
                      ? "success"
                      : data.configured
                        ? "outline"
                        : "warning"
                  }
                >
                  {data.connected
                    ? (data.workspace ?? "Connected")
                    : data.configured
                      ? "Not connected"
                      : "Not set up"}
                </Badge>
              </header>
              {data.connected ? (
                <Connected status={data} />
              ) : data.configured ? (
                <NotConnected canManage={data.canManage} />
              ) : (
                <NotSetUp command={data.setupCommand} />
              )}
            </CardContent>
          </Card>
        )}
      </QueryState>
    </section>
  );
}

function NotSetUp({ command }: { command: string | null }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Slack isn't set up on this gateway.</p>
      <p className="text-muted-foreground">
        Team agents post to Slack through the Every App gateway's Slack app,
        which holds its client. Nothing is pasted into the CRM.
      </p>
      {command ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Register a Slack app, then set its client once on the gateway:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
              {command}
            </code>
            <CopyButton
              value={command}
              successMessage="Command copied"
              label="Copy the command that sets up Slack"
              size="icon-xs"
              variant="ghost"
            />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">
          Ask whoever runs your Every App gateway to set up Slack.
        </p>
      )}
    </div>
  );
}

function NotConnected({ canManage }: { canManage: boolean }) {
  const connect = useMutation({
    mutationFn: () => startSlackConnect(),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Connecting Slack gives the CRM a way in and a way out. What it does with
        that is up to you afterwards, one agent at a time.
      </p>
      <ScopeGroups
        title="What you are handing over"
        scopes={[...SLACK_BOT_SCOPES]}
      />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">What it will never do</h3>
        {NEVER.map((line) => (
          <p key={line} className="flex items-start gap-2 text-sm">
            <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {line}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <Button
          disabled={!canManage}
          pending={connect.isPending}
          onClick={() => connect.mutate()}
        >
          Connect Slack
        </Button>
        <p className="text-xs text-muted-foreground">
          {canManage
            ? "You approve the workspace in Slack. You can disconnect it here at any time."
            : "One Slack workspace is shared by everyone here: an owner or admin connects it."}
        </p>
      </div>
    </div>
  );
}

function Connected({
  status,
}: {
  status: Extract<Status, { connected: true }>;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => disconnectSlack(),
    onSuccess: async () => {
      setConfirming(false);
      toast.success("Slack disconnected.");
      await queryClient.invalidateQueries({ queryKey: slackKeys.all });
    },
  });
  const reconnect = useMutation({
    mutationFn: () => startSlackConnect(),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const withheld = [
    ...describeSlackScopes(status.missing),
    ...(status.canInviteItself ? [] : [SLACK_USER_GRANT]),
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {status.canManage
            ? "Agents only post where their deployed version says."
            : "Agents only post where their deployed version says. Only an owner or an admin can disconnect it."}
        </p>
        {status.canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
      {withheld.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>
            Slack held back {withheld.length} permission
            {withheld.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {withheld.map((entry) => (
                <li key={entry.scope}>{entry.grant}</li>
              ))}
            </ul>
            {status.canManage ? (
              <Button
                className="mt-2"
                size="xs"
                variant="outline"
                pending={reconnect.isPending}
                onClick={() => reconnect.mutate()}
              >
                Reconnect
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {status.syncError ? (
        <p className="text-xs text-warning">{status.syncError}</p>
      ) : null}
      <ScopeGroups title="What this workspace granted" scopes={status.scopes} />
      <SlackChannels />
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Agents that post to Slack</h3>
        {status.agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deployed agents post to Slack yet.{" "}
            <Link to="/agents/new" className="underline underline-offset-4">
              Describe one in the builder.
            </Link>
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {status.agents.map((agent) => (
              <Link
                key={agent.id}
                to="/agents/$agentId"
                params={{ agentId: agent.id }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {agent.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Posts to {agent.destination}
                  </span>
                </span>
                <Badge
                  variant={agent.status === "LIVE" ? "success" : "warning"}
                >
                  {agent.status === "LIVE" ? "Running" : "Paused"}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </section>
      <SlackPeople />
      {confirming ? (
        <ConfirmDialog
          title={`Disconnect ${status.workspace ?? "Slack"}?`}
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirming(false)}
        >
          Agents stop posting to Slack at once, and the channel list is cleared.
          Who is matched to which Slack account is kept, so reconnecting the
          same workspace doesn't match everyone again.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
