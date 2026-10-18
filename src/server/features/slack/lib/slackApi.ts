import { z } from "zod";

// Calling Slack's Web API with the workspace's tokens, ported from the CRM's
// slack-membership.ts, slack-people.ts and run-runtime.ts. A rate-limited call
// waits as Slack says and tries again, up to three times. Every refusal is
// reported as Slack's own error code, which `explainSlackError` turns into
// something a person can act on. Tokens go in the Authorization header only;
// nothing here logs a request or a response.

const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

const envelope = z
  .object({
    ok: z.boolean().catch(false),
    error: z.string().optional().catch(undefined),
  })
  .catch({ ok: false, error: "unreadable_reply" });

type SlackReply = { ok: boolean; error?: string; body: unknown };

export class SlackError extends Error {
  constructor(readonly code: string) {
    super(explainSlackError(code));
    this.name = "SlackError";
  }
}

/** One Slack Web API call: a JSON POST, or a GET with `query`. */
export async function slackCall(
  token: string,
  method: string,
  options: {
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  } = {},
  attempt = 1,
): Promise<SlackReply> {
  const fetcher = options.fetcher ?? fetch;
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetcher(url, {
    method: options.body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body
        ? { "content-type": "application/json; charset=utf-8" }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = envelope.parse(body);
  if (
    !parsed.ok &&
    (parsed.error === "ratelimited" || response.status === 429) &&
    attempt < MAX_ATTEMPTS
  ) {
    const wait = Number(response.headers.get("retry-after") ?? "1");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(Math.max(wait, 1), 10) * 1000),
    );
    return slackCall(token, method, options, attempt + 1);
  }
  if (!parsed.ok && !response.ok && !parsed.error) {
    return { ok: false, error: `http_${response.status}`, body };
  }
  return { ok: parsed.ok, error: parsed.error, body };
}

/** The call, or a SlackError with Slack's reason. */
export async function slackCallOrThrow(
  ...args: Parameters<typeof slackCall>
): Promise<unknown> {
  const reply = await slackCall(...args);
  if (!reply.ok) throw new SlackError(reply.error ?? "rejected");
  return reply.body;
}

/**
 * One page of a cursor-paginated list method (`cursor` empty for the first):
 * the items under `list.key`, and the next page's cursor, empty after the
 * last.
 */
export async function slackPage<Item>(
  token: string,
  method: string,
  list: { key: string; item: z.ZodType<Item>; query?: Record<string, string> },
  cursor: string,
): Promise<{ items: Item[]; next: string }> {
  const body = await slackCallOrThrow(token, method, {
    query: { limit: "200", ...list.query, ...(cursor ? { cursor } : {}) },
  });
  const record = z.record(z.string(), z.unknown()).catch({}).parse(body);
  const items = z
    .array(z.unknown())
    .catch([])
    .parse(record[list.key])
    .flatMap((entry) => {
      const one = list.item.safeParse(entry);
      return one.success ? [one.data] : [];
    });
  const next = z
    .object({ next_cursor: z.string().nullish() })
    .nullish()
    .catch(null)
    .parse(record.response_metadata)?.next_cursor;
  return { items, next: next ?? "" };
}

/** Slack's error code in words a person can act on. */
export function explainSlackError(code: string): string {
  switch (code) {
    case "no_user_grant":
      return "This workspace didn't let the CRM add itself to private channels. Reconnect Slack and allow it, or ask someone in the channel to invite the app.";
    case "channel_not_found":
      return "Slack can't see this channel. Someone in it has to invite the app.";
    case "not_in_channel":
      return "The Slack app isn't in the approved channel. Invite it to that channel, then retry the run.";
    case "is_archived":
      return "This channel is archived. Someone has to unarchive it first.";
    case "missing_scope":
      return "Slack refused: a permission is missing. Reconnect Slack.";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
    case "not_authed":
      return "Slack needs to be reconnected.";
    case "name_taken":
      return "A channel with that name already exists.";
    case "invalid_name_specials":
    case "invalid_name":
      return "Slack doesn't accept that channel name.";
    case "not_connected":
      return "Slack isn't connected.";
    case "unreadable_reply":
      return "Slack sent back something unreadable.";
    default:
      return `Slack refused the request (${code}).`;
  }
}
