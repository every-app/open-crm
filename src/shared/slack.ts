// What the CRM asks Slack for, ported from the CRM's slack-scopes.ts. The
// bot scopes are what the app's bot holds; the user scopes are the
// installer's, and let the app create private channels and invite itself
// into them. The settings page shows each grant in plain words, and which
// ones Slack held back.

export type SlackScopeGroup = "people" | "read" | "send" | "change";

export type SlackScope = {
  scope: string;
  group?: SlackScopeGroup;
  grant: string;
  sensitive: boolean;
};

export const SLACK_SCOPES: readonly SlackScope[] = [
  {
    scope: "users:read",
    group: "people",
    grant: "See the people in your workspace",
    sensitive: false,
  },
  {
    scope: "users:read.email",
    group: "people",
    grant: "See their email addresses, so it can match them to CRM members",
    sensitive: true,
  },
  {
    scope: "channels:read",
    group: "read",
    grant: "See the name and topic of every public channel",
    sensitive: false,
  },
  {
    scope: "groups:read",
    group: "read",
    grant: "See private channels it has been added to",
    sensitive: false,
  },
  {
    scope: "channels:history",
    group: "read",
    grant: "Read messages in public channels it has been added to",
    sensitive: true,
  },
  {
    scope: "groups:history",
    group: "read",
    grant: "Read messages in private channels it has been added to",
    sensitive: false,
  },
  {
    scope: "chat:write",
    group: "send",
    grant: "Post messages as the app",
    sensitive: false,
  },
  {
    scope: "chat:write.public",
    group: "send",
    grant: "Post to any public channel, including ones it has not joined",
    sensitive: true,
  },
  {
    scope: "im:write",
    group: "send",
    grant: "Open a direct message with a person",
    sensitive: false,
  },
  {
    scope: "channels:join",
    group: "change",
    grant: "Join a public channel by itself",
    sensitive: true,
  },
  {
    scope: "channels:manage",
    group: "change",
    grant: "Create public channels, and rename or archive ones it is in",
    sensitive: true,
  },
  {
    scope: "groups:write",
    group: "change",
    grant: "Create private channels, and rename or archive ones it is in",
    sensitive: true,
  },
  {
    scope: "channels:write.invites",
    group: "change",
    grant: "Invite people to a public channel",
    sensitive: true,
  },
  {
    scope: "groups:write.invites",
    group: "change",
    grant: "Invite people to a private channel",
    sensitive: true,
  },
  {
    scope: "conversations.connect:write",
    group: "change",
    grant: "Send and accept Slack Connect invitations",
    sensitive: true,
  },
  {
    scope: "links:write",
    group: "send",
    grant: "Show a preview under a link it posts",
    sensitive: false,
  },
];

/** The bot scopes the authorize URL asks for (`scope`). */
export const SLACK_BOT_SCOPES = SLACK_SCOPES.map((entry) => entry.scope);

/** The installer's scopes the authorize URL asks for (`user_scope`). */
export const SLACK_USER_SCOPES = [
  "channels:read",
  "channels:write",
  "groups:read",
  "groups:write",
] as const;

/** The grant the user scopes amount to, shown when Slack withheld them. */
export const SLACK_USER_GRANT = {
  scope: "slack:user-invite",
  grant: "Add itself to a private channel on your behalf",
  sensitive: true,
} as const satisfies SlackScope;

/** Where Slack sends the installer back, on the CRM's own host. */
export const SLACK_REDIRECT_PATH = "/integrations/slack/callback";

export const SLACK_SCOPE_GROUPS: ReadonlyArray<{
  id: SlackScopeGroup;
  label: string;
  summary: string;
}> = [
  {
    id: "people",
    label: "People",
    summary:
      "Names and email addresses, so it can match a Slack account to a CRM member.",
  },
  {
    id: "read",
    label: "Channels it can read",
    summary:
      "Names and topics of public channels, and the messages in any channel it has been added to.",
  },
  {
    id: "send",
    label: "Messages it can send",
    summary:
      "Post as the app, open a direct message, and preview a link it posts.",
  },
  {
    id: "change",
    label: "Channels it can change",
    summary: "Join, create, rename, archive, and invite people to channels.",
  },
];

/** Each granted scope described; one we don't know reads as broad. */
export function describeSlackScopes(granted: readonly string[]): SlackScope[] {
  const known = new Map(SLACK_SCOPES.map((entry) => [entry.scope, entry]));
  return granted.map(
    (scope) =>
      known.get(scope) ?? {
        scope,
        grant: `An undocumented permission named ${scope}`,
        sensitive: true,
      },
  );
}

/** The requested scopes the workspace did not grant. */
export function missingSlackScopes(granted: readonly string[]): SlackScope[] {
  const held = new Set(granted);
  return SLACK_SCOPES.filter((entry) => !held.has(entry.scope));
}

/** A comma- or space-separated scope list, as Slack reports one. */
export function scopeList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}
