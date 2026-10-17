import type { ConnectionsStatus } from "@/server/features/mailbox/services/ConnectionService";
import type {
  ConnectError,
  MailboxProvider,
  SyncSource,
} from "@/shared/mailbox";

// Settings → Connections' words, ported from the CRM's connection pages.

export type ProviderStatus = ConnectionsStatus["providers"][number];
export type Connection = NonNullable<ProviderStatus["connection"]>;

export const COPY = {
  google: {
    name: "Google",
    offer:
      "Read-only Gmail and Calendar. Only conversations with companies in the CRM are stored.",
    connected:
      "Meetings and email threads land on the matching company as they happen.",
    manage: "https://myaccount.google.com/permissions",
    manageLabel: "Manage in your Google account",
    purged: "Every email and meeting brought in from Google is removed",
    disconnect:
      "Google's access is withdrawn and new email and meetings stop arriving. Everything already synced stays, and you can connect Google again from this page.",
  },
  microsoft: {
    name: "Microsoft",
    offer:
      "Read-only Outlook mail. Only conversations with companies in the CRM are stored.",
    connected: "Email threads land on the matching company as they happen.",
    manage: "https://myapplications.microsoft.com",
    manageLabel: "Manage in your Microsoft account",
    purged: "Every email brought in from Outlook is removed",
    disconnect:
      "New email stops arriving. Everything already synced stays, and you can connect Microsoft again from this page. Microsoft has no way for us to withdraw the consent itself: remove this app from your Microsoft account to do that.",
  },
} as const satisfies Record<MailboxProvider, Record<string, string>>;

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
      return `You didn't give ${name} access, so nothing was connected.`;
    case "scope_not_granted":
      return provider === "google"
        ? "Google didn't grant access to Gmail or Calendar. Connect again and leave at least one of them ticked."
        : "Microsoft didn't grant access to your mail. Connect again and accept the permissions.";
    case "state_mismatch":
      return "That sign-in was already used, expired, or started by someone else. Connect again from this page.";
    case "exchange_failed":
      return `${name} returned an error before the connection was made. Try again.`;
    case "mailbox_unknown":
      return `${name} didn't say which mailbox this is. Try again.`;
  }
}
