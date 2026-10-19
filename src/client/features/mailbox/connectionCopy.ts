import type { ConnectionState } from "@/client/features/settings/ConnectionStatus";
import type { ConnectionsStatus } from "@/server/features/mailbox/services/ConnectionService";
import type {
  ConnectError,
  MailboxProvider,
  SyncSource,
} from "@/shared/mailbox";

// The mail providers' words, from the CRM's connection pages.

export type ProviderStatus = ConnectionsStatus["providers"][number];
export type Connection = NonNullable<ProviderStatus["connection"]>;

export const COPY = {
  google: {
    title: "Google Workspace",
    name: "Google",
    manage: "https://myaccount.google.com/permissions",
    manageLabel: "Manage in Google",
    purged:
      "Every email and meeting brought in from Google is removed from the CRM.",
    revoke: "Revoke Google access",
    revokeAction: "Revoke",
    stops: "New email and meetings stop arriving.",
    // Disconnecting revokes Google's grant as well: nothing more to do.
    revoked: null,
    register:
      "Register an OAuth client with Google and allow this redirect URI.",
  },
  microsoft: {
    title: "Microsoft 365",
    name: "Microsoft",
    manage: "https://myapplications.microsoft.com",
    manageLabel: "Manage in Microsoft",
    purged: "Every email brought in from Outlook is removed from the CRM.",
    revoke: "Disconnect Microsoft",
    revokeAction: "Disconnect",
    stops: "New email stops arriving.",
    revoked:
      "To withdraw the consent itself, remove this app from your Microsoft account.",
    register:
      "Register an app with Microsoft for accounts in any organization and personal accounts, and allow this redirect URI.",
  },
} as const satisfies Record<MailboxProvider, Record<string, string | null>>;

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
    case "access_denied":
      // Microsoft sends a member whose organization lets only an admin
      // consent back as a decline too (adminConsent.ts).
      return provider === "microsoft"
        ? "You didn't give Microsoft access, or a Microsoft 365 admin has to approve the CRM first."
        : `You didn't give ${name} access.`;
    case "scope_not_granted":
      return provider === "google"
        ? "Google didn't grant access to Gmail or Calendar. Connect again and leave at least one of them ticked."
        : "Microsoft didn't grant access to your mail. Connect again and accept the permissions.";
    case "state_mismatch":
      return "That sign-in was already used, expired, or started by someone else. Connect again.";
    case "exchange_failed":
      return `${name} returned an error. Try again.`;
    case "mailbox_unknown":
      return `${name} didn't say which mailbox this is. Try again.`;
    case "email_doesn't_match":
      return `That ${name} account has a different email address to the one you sign in with. Connect the ${name} account that matches your sign-in address.`;
  }
}

/** The provider's status badge: set up, connected, and working. */
export function mailboxState(status: ProviderStatus): ConnectionState {
  const { connection } = status;
  if (!connection) return status.ready ? "disconnected" : "unconfigured";
  const healthy =
    connection.hasRefreshToken &&
    !connection.needsReconnect &&
    !connection.sources.some(
      (source) =>
        source.granted &&
        (source.status === "NEEDS_RECONNECT" || source.lastError),
    );
  return healthy ? "connected" : "attention";
}
