import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, TriangleAlert } from "lucide-react";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { ConnectionBadge } from "@/client/features/settings/ConnectionStatus";
import { GatewaySetupRows } from "@/client/features/settings/GatewaySetupRows";
import {
  startSlackConnect,
  type getSlackStatus,
} from "@/serverFunctions/slack";
import {
  SLACK_BOT_SCOPES,
  SLACK_REDIRECT_PATH,
  type SlackConnectError,
} from "@/shared/slack";
import { ScopeGroups } from "./SlackScopeGroups";

// Settings → Connections → Slack before it is connected (the CRM's Slack
// page): what connecting hands over and never does, then Connect, or what
// the gateway needs first.

type Status = Awaited<ReturnType<typeof getSlackStatus>>;

const SUGGESTIONS = [
  ["When a deal is created", "Post the deal to an approved sales channel."],
  ["When a deal is won", "Tell an approved channel that the deal closed."],
  ["When a deal reopens", "Notify one approved channel or teammate."],
] as const;

/** Why a connect came back without Slack, from the callback's outcome. */
const CONNECT_ERRORS: Record<SlackConnectError, string> = {
  access_denied: "Slack installation was cancelled.",
  invalid_state:
    "That Slack approval expired or was started by someone else. Start again.",
  forbidden: "Only an owner or an admin can connect Slack.",
  exchange_failed:
    "Slack rejected the app credentials or redirect URL. Check them, then try again.",
  not_configured: "Slack is not configured.",
  rejected: "Slack didn't finish the installation. Try again.",
  failed: "Slack could not be connected. Try again.",
};

/** A connect that came back without Slack, connected or not: why. */
export function SlackConnectAlert({ error }: { error?: SlackConnectError }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{CONNECT_ERRORS[error]}</AlertTitle>
    </Alert>
  );
}

/** Starts a connect: off to Slack to approve the workspace. */
export function useSlackConnect() {
  return useMutation({
    mutationFn: () => startSlackConnect(),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function SlackNotConnected({
  status,
  connectError,
}: {
  status: Status;
  connectError?: SlackConnectError;
}) {
  const connect = useSlackConnect();

  return (
    <SettingsPage
      title="Slack"
      actions={
        // Level with the title's line.
        <span className="flex h-8 items-center">
          <ConnectionBadge
            state={status.configured ? "disconnected" : "unconfigured"}
          />
        </span>
      }
    >
      <SlackConnectAlert error={connectError} />
      <ScopeGroups title="Slack access" scopes={SLACK_BOT_SCOPES} />

      {status.configured ? (
        <SettingsCard>
          <SettingsRow
            label="Connect Slack"
            description={
              status.canManage ? undefined : CONNECT_ERRORS.forbidden
            }
          >
            <Button
              disabled={!status.canManage}
              pending={connect.isPending}
              onClick={() => connect.mutate()}
            >
              {connect.isPending ? "Opening Slack…" : "Connect"}
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : (
        <SettingsSection
          title="Slack is not configured"
          description={
            status.setup
              ? undefined
              : "Ask whoever runs your Every App gateway to set up Slack."
          }
        >
          {status.setup ? (
            <SettingsCard>
              <GatewaySetupRows
                redirectLabel="Redirect URL"
                // Slack sends the owner back to this CRM's own host.
                redirectUri={`${window.location.origin}${SLACK_REDIRECT_PATH}`}
                register="Register a Slack app with this redirect URL."
                setup={status.setup}
              />
            </SettingsCard>
          ) : null}
        </SettingsSection>
      )}
      <SettingsSection title="Suggestions">
        <div className="grid gap-3 md:grid-cols-3">
          {SUGGESTIONS.map(([name, description]) => (
            <Link
              key={name}
              to="/settings/connections"
              hash="ai-clients"
              className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs outline-none hover:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {name}
                <ArrowRight
                  aria-hidden
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </span>
            </Link>
          ))}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
