import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/client/components/SettingsSection";
import {
  Alert,
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
          return entry.connection ? (
            <ConnectedMailbox status={entry} connection={entry.connection} />
          ) : (
            <NotConnected status={entry} connectError={error} />
          );
        }}
      </QueryState>
    </SettingsPage>
  );
}

function NotConnected({
  status,
  connectError,
}: {
  status: ProviderStatus;
  connectError?: ConnectError;
}) {
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
          ? copy.offer
          : `${copy.name} isn't set up on this Every App gateway yet.`
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
      {connectError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{copy.name} did not finish connecting</AlertTitle>
          <AlertDescription>
            {connectErrorCopy(provider, connectError)}
          </AlertDescription>
        </Alert>
      ) : null}
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
