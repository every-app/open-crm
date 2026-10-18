// Mail and calendar capture: the two providers a member connects, the
// sources each brings in, and the states a source's sync is in. Shared by
// the schema, the server and Settings → Connections.

export const MAILBOX_PROVIDERS = ["google", "microsoft"] as const;
export type MailboxProvider = (typeof MAILBOX_PROVIDERS)[number];

export const SYNC_SOURCES = ["calendar", "gmail", "outlook"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const SOURCES_BY_PROVIDER = {
  google: ["calendar", "gmail"],
  microsoft: ["outlook"],
} as const satisfies Record<MailboxProvider, readonly SyncSource[]>;

export const PROVIDER_FOR_SOURCE = {
  calendar: "google",
  gmail: "google",
  outlook: "microsoft",
} as const satisfies Record<SyncSource, MailboxProvider>;

/**
 * IDLE: waiting for its next check. RUNNING: a check holds its lease.
 * NEEDS_RECONNECT: the provider refused the grant; nothing runs until the
 * member connects again. FAILED: the last check failed; the next one retries.
 */
export const SYNC_STATUSES = [
  "IDLE",
  "RUNNING",
  "NEEDS_RECONNECT",
  "FAILED",
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const CONNECTION_STATUSES = ["ACTIVE", "NEEDS_RECONNECT"] as const;

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const OUTLOOK_MAIL_SCOPE = "Mail.Read";

export const SCOPE_FOR_SOURCE = {
  calendar: CALENDAR_SCOPE,
  gmail: GMAIL_SCOPE,
  outlook: OUTLOOK_MAIL_SCOPE,
} as const satisfies Record<SyncSource, string>;

/** The scopes each provider's authorize page asks for (the gateway's client allows them). */
export const REQUESTED_SCOPES = {
  google: [GMAIL_SCOPE, CALENDAR_SCOPE],
  microsoft: ["offline_access", "User.Read", OUTLOOK_MAIL_SCOPE],
} as const satisfies Record<MailboxProvider, readonly string[]>;

/** Auto-create defaults when a source is first connected, as in the CRM. */
export const AUTO_CREATE_DEFAULT = {
  calendar: true,
  gmail: false,
  outlook: false,
} as const satisfies Record<SyncSource, boolean>;

/** Why the connect callback sent the member back without a connection. */
export const CONNECT_ERRORS = [
  "access_denied",
  "scope_not_granted",
  "state_mismatch",
  "exchange_failed",
  "mailbox_unknown",
  // The CRM's (Better Auth's) code: a mailbox not at the sign-in address.
  "email_doesn't_match",
] as const;
export type ConnectError = (typeof CONNECT_ERRORS)[number];

const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

/** A token response's `scope` as a set; Graph's prefix is dropped. */
function parseScopes(scope: string | null | undefined): Set<string> {
  return new Set(
    (scope ?? "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) =>
        entry.startsWith(GRAPH_SCOPE_PREFIX)
          ? entry.slice(GRAPH_SCOPE_PREFIX.length)
          : entry,
      ),
  );
}

/** The sources of `provider` that `scopes` (a stored scope string) grants. */
export function grantedSources(
  provider: MailboxProvider,
  scopes: string | null | undefined,
): SyncSource[] {
  const granted = parseScopes(scopes);
  return SOURCES_BY_PROVIDER[provider].filter((source) =>
    granted.has(SCOPE_FOR_SOURCE[source]),
  );
}
