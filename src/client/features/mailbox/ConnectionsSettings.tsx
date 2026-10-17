import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/client/components/CopyButton";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
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
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  ConnectedCard,
  useConnect,
} from "@/client/features/mailbox/ConnectedCard";
import {
  COPY,
  connectErrorCopy,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { connectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import type { ConnectError, MailboxProvider } from "@/shared/mailbox";

// Settings → Connections, ported from the CRM's settings/connections pages:
// each member connects their own Google or Microsoft mailbox, read only, and
// what it brings in is filed on the organization's companies and contacts.

const POLL_MS = 3000;

export function ConnectionsSettings({
  provider,
  connected,
  error,
}: {
  provider?: MailboxProvider;
  connected?: "1";
  error?: ConnectError;
}) {
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
    if (provider && connected) {
      toast.success(`${COPY[provider].name} connected.`);
      void navigate({ to: "/settings/connections", search: {}, replace: true });
    }
  }, [provider, connected, navigate]);

  return (
    <section className="space-y-3">
      <SectionHeader title="Connections" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Connect your own mailbox and calendar, and the CRM files your work
        conversations and meetings on the right companies and contacts. It only
        reads: it never sends, changes or drafts anything.
      </p>
      <QueryState
        query={query}
        errorFallback="Your connections could not be loaded."
      >
        {(status) => (
          <div className="grid max-w-2xl gap-4">
            {status.providers.map((entry) => (
              <ProviderCard
                key={entry.provider}
                status={entry}
                connectError={entry.provider === provider ? error : undefined}
              />
            ))}
          </div>
        )}
      </QueryState>
    </section>
  );
}
function ProviderCard({
  status,
  connectError,
}: {
  status: ProviderStatus;
  connectError?: ConnectError;
}) {
  const copy = COPY[status.provider];
  const connect = useConnect(status.provider);
  const { connection } = status;

  if (connection) {
    return <ConnectedCard status={status} connection={connection} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {copy.name}
          {status.ready ? (
            <Badge variant="secondary">Not connected</Badge>
          ) : (
            <Badge variant="warning">Not set up</Badge>
          )}
        </CardTitle>
        <CardDescription>{copy.offer}</CardDescription>
        {status.ready ? (
          <CardAction>
            <Button
              size="sm"
              pending={connect.isPending}
              onClick={() => connect.mutate()}
            >
              Connect
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      {connectError || !status.ready ? (
        <CardContent className="space-y-3">
          {connectError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{copy.name} did not finish connecting</AlertTitle>
              <AlertDescription>
                {connectErrorCopy(status.provider, connectError)}
              </AlertDescription>
            </Alert>
          ) : null}
          {status.ready ? null : <NotSetUp status={status} />}
        </CardContent>
      ) : null}
    </Card>
  );
}

/** What it takes to offer the provider, for an owner or admin of a fork. */
function NotSetUp({ status }: { status: ProviderStatus }) {
  const name = COPY[status.provider].name;
  if (!status.setup) {
    return (
      <p className="text-xs text-muted-foreground">
        {name} isn't set up on this Every App gateway. Its operator sets it up
        once for everyone.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      {status.setup.devVars ? (
        <p>
          {name} isn't set up for local development. Register an OAuth client
          with {name}, allow this redirect URI, then put the client in .dev.vars
          as {status.setup.devVars.join(" and ")}:
        </p>
      ) : (
        <p>
          {name} isn't set up on this Every App gateway. Register an OAuth
          client with {name}, allow this redirect URI, then give the client to
          the gateway:
        </p>
      )}
      <CommandLine value={status.setup.redirectUri} label="redirect URI" />
      {status.setup.command ? (
        <CommandLine value={status.setup.command} label="command" />
      ) : null}
      {status.provider === "google" ? (
        <p>
          Gmail's read scope is restricted: an Internal consent screen (your own
          Workspace's mailboxes) needs no review; an External one needs Google's
          verification and security assessment.
        </p>
      ) : (
        <p>
          Register it for accounts in any organization and personal accounts.
        </p>
      )}
    </div>
  );
}

function CommandLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
        {value}
      </code>
      <CopyButton
        value={value}
        successMessage="Copied"
        label={`Copy the ${label}`}
        size="icon-xs"
        variant="ghost"
      />
    </div>
  );
}
