import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/client/components/SettingsSection";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  ConnectedMailbox,
  useConnect,
} from "@/client/features/mailbox/ConnectedMailbox";
import {
  COPY,
  connectErrorCopy,
  mailboxState,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { connectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import {
  ConnectionBadge,
  TitleWithStatus,
} from "@/client/features/settings/ConnectionStatus";
import { GatewaySetupRows } from "@/client/features/settings/GatewaySetupRows";
import {
  GoogleLogo,
  MicrosoftLogo,
} from "@/client/features/settings/brandLogos";
import type { ConnectError, MailboxProvider } from "@/shared/mailbox";

// Settings → Connections → Google or Microsoft (the CRM's provider pages):
// the member's own mailbox, read only, or what it takes to connect one.

const POLL_MS = 3000;

const LOGOS = { google: GoogleLogo, microsoft: MicrosoftLogo } as const;

export function MailboxConnectionPage({
  provider,
  connected,
  error,
}: {
  provider: MailboxProvider;
  connected?: 1;
  error?: ConnectError;
}) {
  const copy = COPY[provider];
  const navigate = useNavigate();
  const query = useQuery({
    ...connectionsQueryOptions(),
    refetchInterval: (state) =>
      state.state.data?.providers.some((entry) =>
        entry.connection?.sources.some((source) => source.syncing),
      )
        ? POLL_MS
        : false,
  });

  // A connect came back: say so once, then drop it from the address.
  useEffect(() => {
    if (!connected) return;
    toast.success(`${copy.name} connected.`);
    void navigate({ to: ".", search: {}, replace: true });
  }, [connected, copy.name, navigate]);

  return (
    <SettingsPage title={copy.title}>
      <QueryState
        query={query}
        errorFallback="Your connections could not be loaded."
      >
        {(status) => {
          const entry = status.providers.find(
            (candidate) => candidate.provider === provider,
          );
          if (!entry) return null;
          return (
            <>
              {/* A connect or a reconnect that came back without it. */}
              {error ? (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>{copy.name} did not finish connecting</AlertTitle>
                  <AlertDescription>
                    {connectErrorCopy(provider, error)}
                  </AlertDescription>
                  {error === "access_denied" && entry.adminConsentUrl ? (
                    <AlertAction>
                      <Button
                        variant="outline"
                        size="xs"
                        nativeButton={false}
                        render={
                          <a
                            href={entry.adminConsentUrl}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        Grant admin consent
                        <ExternalLink data-icon="inline-end" aria-hidden />
                      </Button>
                    </AlertAction>
                  ) : null}
                </Alert>
              ) : null}
              {entry.connection ? (
                <ConnectedMailbox
                  status={entry}
                  connection={entry.connection}
                />
              ) : (
                <NotConnected status={entry} />
              )}
            </>
          );
        }}
      </QueryState>
    </SettingsPage>
  );
}

function NotConnected({ status }: { status: ProviderStatus }) {
  const { provider, ready, setup } = status;
  const copy = COPY[provider];
  const Logo = LOGOS[provider];
  const connect = useConnect(provider);

  return (
    <SettingsSection
      title={
        <TitleWithStatus
          status={<ConnectionBadge state={mailboxState(status)} />}
        >
          {copy.name}
        </TitleWithStatus>
      }
      description={
        ready || setup
          ? "Only conversations with companies in the CRM are stored. Everyone in the workspace, their AI clients and the CRM's agents can read them."
          : undefined
      }
      action={
        ready ? (
          <Button pending={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? null : <Logo data-icon="inline-start" />}
            Connect
          </Button>
        ) : null
      }
    >
      {!ready && setup ? (
        <SettingsCard>
          <GatewaySetupRows
            redirectUri={setup.redirectUri}
            register={copy.register}
            setup={setup}
          />
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
