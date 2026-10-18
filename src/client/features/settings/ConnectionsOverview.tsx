import type { ComponentType, SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QueryError } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { COPY, mailboxState } from "@/client/features/mailbox/connectionCopy";
import { connectionsQueryOptions } from "@/client/features/mailbox/mailboxQueries";
import {
  ConnectionBadge,
  type ConnectionState,
} from "@/client/features/settings/ConnectionStatus";
import {
  GoogleLogo,
  MicrosoftLogo,
  SlackLogo,
} from "@/client/features/settings/brandLogos";
import { slackStatusQueryOptions } from "@/client/features/slack/slackQueries";

type Connection = {
  name: string;
  logo: ComponentType<SVGProps<SVGSVGElement>>;
  to:
    | "/settings/connections/google"
    | "/settings/connections/slack"
    | "/settings/connections/microsoft";
  /** Null while it loads. */
  state: ConnectionState | null;
  label?: string;
};

/**
 * Settings → Connections (the CRM's connections page): each connection, its
 * state, and the way to its own page.
 */
export function ConnectionsOverview() {
  const mailbox = useQuery(connectionsQueryOptions());
  const slack = useQuery(slackStatusQueryOptions());
  const provider = (name: "google" | "microsoft") =>
    mailbox.data?.providers.find((entry) => entry.provider === name);
  const google = provider("google");
  const microsoft = provider("microsoft");
  const workspace = slack.data?.connected ? slack.data.workspace : null;

  const connections: Connection[] = [
    {
      name: COPY.google.title,
      logo: GoogleLogo,
      to: "/settings/connections/google",
      state: google ? mailboxState(google) : null,
    },
    {
      name: "Slack",
      logo: SlackLogo,
      to: "/settings/connections/slack",
      state: slack.data
        ? slack.data.connected
          ? "connected"
          : slack.data.configured
            ? "disconnected"
            : "unconfigured"
        : null,
      label: workspace ? `Connected to ${workspace}` : undefined,
    },
    {
      name: COPY.microsoft.title,
      logo: MicrosoftLogo,
      to: "/settings/connections/microsoft",
      state: microsoft ? mailboxState(microsoft) : null,
    },
  ];

  return (
    <SettingsPage title="Connections">
      {mailbox.isError || slack.isError ? (
        <QueryError
          error={mailbox.error ?? slack.error}
          fallback="The connections could not be loaded."
          onRetry={() => {
            void mailbox.refetch();
            void slack.refetch();
          }}
        />
      ) : null}
      <SettingsCard>
        {connections.map((connection) => (
          <ConnectionRow key={connection.name} connection={connection} />
        ))}
      </SettingsCard>
    </SettingsPage>
  );
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const Logo = connection.logo;
  const linked =
    connection.state === "connected" || connection.state === "attention";
  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2.5">
          <Logo className="size-4 shrink-0" />
          {connection.name}
        </span>
      }
    >
      {connection.state ? (
        <ConnectionBadge state={connection.state} label={connection.label} />
      ) : (
        <Skeleton className="h-5 w-24" />
      )}
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link to={connection.to} />}
      >
        {linked ? "Manage" : "Connect"}
      </Button>
    </SettingsRow>
  );
}
