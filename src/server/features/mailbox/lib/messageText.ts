// A captured message's text and its place in a conversation, ported from the
// CRM's mailbox/message-text.ts. A thread is keyed by RFC message id, not by
// a provider's thread id: its root comes from References, then In-Reply-To,
// then the message's own Message-ID, so two members on Gmail and Outlook land
// on the same thread for the same conversation.

/** Gmail's base64url body data as UTF-8 text; empty when it doesn't decode. */
export function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    "=",
  );
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS: RegExp[] = [
  /^\s*On .+ wrote:\s*$/m,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.+$/m,
  /^\s*Begin forwarded message:\s*$/im,
  /^\s*-{3,}\s*Forwarded message\s*-{3,}\s*$/im,
];

/** The message without the history it quotes. */
export function stripQuotedHistory(body: string): string {
  let cut = body.length;

  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && match.index < cut) cut = match.index;
  }

  const lines = body.slice(0, cut).split("\n");
  while (lines.length > 0 && /^\s*>/.test(lines.at(-1) ?? "")) {
    lines.pop();
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ThreadHeaders = {
  references: string | null;
  inReplyTo: string | null;
  messageId: string | null;
};

/** The conversation's first message id: References → In-Reply-To → own. */
export function rootMessageIdFrom(headers: ThreadHeaders): string | null {
  if (headers.references) {
    const first = firstMessageId(headers.references);
    if (first) return first;
  }

  if (headers.inReplyTo) {
    const first = firstMessageId(headers.inReplyTo);
    if (first) return first;
  }

  return headers.messageId ? normaliseMessageId(headers.messageId) : null;
}

function firstMessageId(value: string): string | null {
  const found = value.match(/<[^<>]+>|[^\s<>]+/);
  return found ? normaliseMessageId(found[0]) : null;
}

export function normaliseMessageId(value: string): string {
  return value.trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

export function snippetOf(body: string, limit = 200): string | null {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
