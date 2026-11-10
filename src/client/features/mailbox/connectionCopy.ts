import type { ConnectionState } from "@/client/features/settings/ConnectionStatus";
import type { ConnectionsStatus } from "@/server/features/mailbox/services/ConnectionService";
import type {
  ConnectError,
  MailboxProvider,
  SyncSource,
} from "@/shared/mailbox";

// The mail providers' words, from the CRM's connection pages.

export type { ConnectionsStatus };
export type ProviderStatus = ConnectionsStatus["providers"][number];
export type Connection = NonNullable<ProviderStatus["connection"]>;

/** What connecting a mailbox saves and who sees it, for whoever connects one. */
export const STORED =
  "Only email and meetings with companies in your CRM are saved. Everyone in the workspace, and any AI client they connect, can read them.";

export const COPY = {
  google: {
    title: "Google Workspace",
    name: "Google",
    connect: "Connect Gmail and Calendar",
    manage: "https://myaccount.google.com/permissions",
    manageLabel: "Manage in Google",
    purged:
      "Every email and meeting brought in from Google is removed from the CRM.",
    revoke: "Disconnect Google",
    revokeAction: "Disconnect",
    stops: "New email and meetings stop arriving.",
    stored: STORED,
  },
  microsoft: {
    title: "Microsoft 365",
    name: "Microsoft",
    connect: "Connect Outlook",
    manage: "https://myapplications.microsoft.com",
    manageLabel: "Manage in Microsoft",
    purged: "Every email brought in from Outlook is removed from the CRM.",
    revoke: "Disconnect Microsoft",
    revokeAction: "Disconnect",
    stops: "New email stops arriving.",
    stored:
      "Only email with companies in your CRM is saved. Everyone in the workspace, and any AI client they connect, can read it.",
  },
} as const satisfies Record<MailboxProvider, Record<string, string>>;

/** What a disconnect leaves: the connection on Every App. */
export const REVOKED =
  "The CRM stops reading it. To remove the connection itself, disconnect it under Connected accounts on Every App.";

/** "Google isn't set up on this Every App gateway yet. An admin sets X and Y." */
export function notSetUpCopy(
  name: string,
  settings: readonly string[],
): string {
  return settings.length > 0
    ? `${name} isn't set up on this Every App gateway yet. An admin sets ${settings.join(" and ")}.`
    : `${name} isn't set up on this Every App gateway yet.`;
}

export const SOURCES = {
  calendar: {
    label: "Meetings",
    autoCreate: "Add the company and contact when you meet someone new",
  },
  gmail: {
    label: "Email",
    autoCreate: "Add the company and contact when you reply to someone new",
  },
  outlook: {
    label: "Email",
    autoCreate: "Add the company and contact when you reply to someone new",
  },
} as const satisfies Record<SyncSource, { label: string; autoCreate: string }>;

export function connectErrorCopy(
  provider: MailboxProvider,
  error: ConnectError,
) {
  const name = COPY[provider].name;
  switch (error) {
    case "not_connected":
      return `Every App has no ${name} connection for you. Connect again.`;
    case "scope_not_granted":
      return provider === "google"
        ? "Google didn't grant access to Gmail or Calendar. Connect again and leave at least one of them ticked."
        : "Microsoft didn't grant access to your mail. Connect again and accept the permissions.";
    case "mailbox_unknown":
      return `${name} didn't say which mailbox this is. Try again.`;
    case "email_doesn't_match":
      return `That ${name} account has a different email address to the one you sign in with. Connect the ${name} account that matches your sign-in address.`;
  }
}

/** The provider's status badge: set up, connected, and working. */
export function mailboxState(
  status: Pick<ProviderStatus, "ready" | "connection">,
): ConnectionState {
  const { connection } = status;
  if (!connection) return status.ready ? "disconnected" : "unconfigured";
  // Nothing syncs while the gateway doesn't offer the provider.
  const healthy =
    status.ready &&
    !connection.needsReconnect &&
    !connection.sources.some(
      (source) =>
        source.granted &&
        (source.status === "NEEDS_RECONNECT" || source.lastError),
    );
  return healthy ? "connected" : "attention";
}
