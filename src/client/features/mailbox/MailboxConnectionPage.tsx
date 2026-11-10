import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
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
import { ProviderSetup } from "@/client/features/mailbox/ProviderSetup";
import {
  ConnectionBadge,
  TitleWithStatus,
} from "@/client/features/settings/ConnectionStatus";
import { PROVIDER_LOGOS } from "@/client/features/settings/brandLogos";
import type { ConnectError, MailboxProvider } from "@/shared/mailbox";

// Settings → Connections → Google or Microsoft (the CRM's provider pages):
// the member's own mailbox, read only, or Connect, which goes through Every
// App: the gateway holds the connection. Until the gateway offers the
// provider, what an admin sets stands in for Connect.

const POLL_MS = 3000;

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
  const entry = query.data?.providers.find(
    (candidate) => candidate.provider === provider,
  );

  // A connect came back: say so once, then drop it from the address.
  useEffect(() => {
    if (!connected) return;
    toast.success(`${copy.name} connected.`);
    void navigate({ to: ".", search: {}, replace: true });
  }, [connected, copy.name, navigate]);

  return (
    <SettingsPage
      title={
        <TitleWithStatus
          status={
            entry ? <ConnectionBadge state={mailboxState(entry)} /> : null
          }
        >
          {copy.title}
        </TitleWithStatus>
      }
      backLink={
        <Link
          to="/settings/connections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Connections
        </Link>
      }
    >
      <QueryState
        query={query}
        errorFallback="Your connections could not be loaded."
      >
        {() =>
          entry ? (
            <>
              {/* A connect or a reconnect that came back without it. */}
              {error ? (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>{copy.name} did not finish connecting</AlertTitle>
                  <AlertDescription>
                    {connectErrorCopy(provider, error)}
                  </AlertDescription>
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
          ) : null
        }
      </QueryState>
    </SettingsPage>
  );
}

function NotConnected({ status }: { status: ProviderStatus }) {
  const copy = COPY[status.provider];
  const Logo = PROVIDER_LOGOS[status.provider];
  const connect = useConnect(status.provider);

  if (!status.ready) return <ProviderSetup status={status} />;
  return (
    <SettingsCard>
      <SettingsRow label={copy.connect} description={copy.stored}>
        <Button pending={connect.isPending} onClick={() => connect.mutate()}>
          {connect.isPending ? null : <Logo data-icon="inline-start" />}
          Connect
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
