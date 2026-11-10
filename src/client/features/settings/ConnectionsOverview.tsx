import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QueryError } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useConnect } from "@/client/features/mailbox/ConnectedMailbox";
import {
  COPY,
  STORED,
  mailboxState,
  type ProviderStatus,
} from "@/client/features/mailbox/connectionCopy";
import { connectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import { MemberMailboxes } from "@/client/features/mailbox/MemberMailboxes";
import { ConnectionBadge } from "@/client/features/settings/ConnectionStatus";
import { PROVIDER_LOGOS } from "@/client/features/settings/brandLogos";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { MAILBOX_PROVIDERS, type MailboxProvider } from "@/shared/mailbox";
import { hasOrgPermission } from "@/shared/org-permissions";
import { ApiSettings } from "./ApiSettings";

const PAGES = {
  google: "/settings/connections/google",
  microsoft: "/settings/connections/microsoft",
} as const satisfies Record<MailboxProvider, string>;

/**
 * Settings → Connections (the CRM's connections page): the member's own
 * mailboxes first, each with its state and what moves it forward; for
 * owners and admins every member's mailbox under them; then AI clients.
 */
export function ConnectionsOverview() {
  const mailbox = useQuery(connectionsQueryOptions());
  const workspace = useQuery(workspaceQueryOptions());
  const canManage = hasOrgPermission(workspace.data?.role ?? "", {
    connection: ["manage"],
  });

  return (
    <SettingsPage title="Connections">
      <SettingsSection title="Email and calendar" description={STORED}>
        {mailbox.isError ? (
          <QueryError
            error={mailbox.error}
            fallback="Your connections could not be loaded."
            onRetry={() => void mailbox.refetch()}
            isRetrying={mailbox.isFetching}
          />
        ) : null}
        {mailbox.data || mailbox.isPending ? (
          <SettingsCard>
            {MAILBOX_PROVIDERS.map((provider) => (
              <ConnectionRow
                key={provider}
                provider={provider}
                status={mailbox.data?.providers.find(
                  (entry) => entry.provider === provider,
                )}
                canManage={canManage}
              />
            ))}
          </SettingsCard>
        ) : null}
        {canManage ? <MemberMailboxes /> : null}
      </SettingsSection>
      <ApiSettings />
    </SettingsPage>
  );
}

function ConnectionRow({
  provider,
  status,
  canManage,
}: {
  provider: MailboxProvider;
  /** Undefined while it loads. */
  status: ProviderStatus | undefined;
  canManage: boolean;
}) {
  const Logo = PROVIDER_LOGOS[provider];
  const connect = useConnect(provider);
  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2.5">
          <Logo className="size-4 shrink-0" />
          {COPY[provider].title}
        </span>
      }
    >
      {status ? (
        <>
          <ConnectionBadge state={mailboxState(status)} />
          {/* Connecting goes through the gateway, so only once it offers the provider. */}
          {status.ready &&
          (!status.connection || status.connection.needsReconnect) ? (
            <Button
              variant={status.connection ? "default" : "outline"}
              pending={connect.isPending}
              onClick={() => connect.mutate()}
            >
              {status.connection ? "Reconnect" : "Connect"}
            </Button>
          ) : null}
          {/* The provider's page: the mailbox's settings, or, while the
              gateway holds no client, the setup command for an owner or
              admin and a sentence naming what an admin sets for a member. */}
          {status.connection || !status.ready ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={PAGES[provider]} />}
            >
              {status.ready ? "Manage" : canManage ? "Set up" : "Details"}
            </Button>
          ) : null}
        </>
      ) : (
        <Skeleton className="h-5 w-24" />
      )}
    </SettingsRow>
  );
}
