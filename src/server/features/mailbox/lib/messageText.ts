// A captured message's text and its place in a conversation, ported from the
// CRM's mailbox/message-text.ts. A thread is keyed by RFC message id, not by
// a provider's thread id: its root comes from References, then In-Reply-To,
// then the message's own Message-ID, so two members on Gmail and Outlook land
// on the same thread for the same conversation.
//
// A message is a stranger's input. Its text is read in one pass over at most
// MAX_TEXT_INPUT characters, never with a regex that can backtrack across it,
// and a body is stored cut at MAX_BODY_LENGTH: a crafted message can neither
// stall a check nor fill the database.

/** How much of a message's text is read; past it, the message is cut. */
const MAX_TEXT_INPUT = 256 * 1024;
/** The longest body a message is stored with. */
const MAX_BODY_LENGTH = 50_000;
/** Base64 that decodes to MAX_TEXT_INPUT characters at up to 3 bytes each. */
const MAX_ENCODED_INPUT = 4 * MAX_TEXT_INPUT;

/** Text as a database stores it: Postgres refuses the NUL character. */
export function withoutNul(text: string): string {
  return text.replaceAll("\0", "");
}

/**
 * Gmail's base64url body data as text in the charset its part declares (a
 * charset the runtime doesn't know reads as UTF-8); empty when it doesn't
 * decode.
 */
export function decodeBase64Url(data: string, charset: string | null): string {
  const normalised = data
    .slice(0, MAX_ENCODED_INPUT)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    "=",
  );
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return withoutNul(decoderFor(charset).decode(bytes));
  } catch {
    return "";
  }
}

function decoderFor(charset: string | null): TextDecoder {
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder();
  }
}

/** Tags whose end stands for a line break. */
const BREAKS = new Set(["br", "/p", "/div", "/tr", "/li"]);
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

/**
 * An HTML body as text, in one pass: tags dropped, a line break for `<br>`
 * and each block's end, the common entities decoded. A style or script is
 * dropped with its content, and one never closed hides the rest, as it does
 * in a mail client.
 */
export function stripHtml(html: string): string {
  const input = html.slice(0, MAX_TEXT_INPUT);
  const parts: string[] = [];
  let at = 0;
  while (at < input.length) {
    const open = input.indexOf("<", at);
    const close = open === -1 ? -1 : input.indexOf(">", open + 1);
    // No tag closes after here: the rest is text.
    if (close === -1) break;
    parts.push(input.slice(at, open));
    at = close + 1;
    if (close === open + 1) {
      parts.push("<>");
      continue;
    }
    const name =
      /^\/?[a-z][a-z0-9]*/i
        .exec(input.slice(open + 1, close))?.[0]
        .toLowerCase() ?? "";
    if (name === "style" || name === "script") {
      const end = new RegExp(`</${name}`, "gi");
      end.lastIndex = at;
      const found = end.exec(input);
      const after = found ? input.indexOf(">", found.index) : -1;
      at = after === -1 ? input.length : after + 1;
    } else if (BREAKS.has(name) || /^\/h[1-6]$/.test(name)) {
      parts.push("\n");
    }
  }
  parts.push(input.slice(at));
  return parts
    .join("")
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39);/g,
      (_entity, name: string) => ENTITIES[name] ?? "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Each is tested against one line, which has no line breaks for `\s` to
// run across.
const QUOTE_MARKERS: RegExp[] = [
  /^\s*On .+ wrote:\s*$/,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*From:\s.+$/,
  /^\s*Begin forwarded message:\s*$/i,
  /^\s*-{3,}\s*Forwarded message\s*-{3,}\s*$/i,
];

/**
 * A message's text as stored: without the history it quotes, and cut at
 * MAX_BODY_LENGTH characters.
 */
export function messageBody(text: string): string {
  const lines = text
    .slice(0, MAX_TEXT_INPUT)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const quoted = lines.findIndex((line) =>
    QUOTE_MARKERS.some((marker) => marker.test(line)),
  );
  const kept = quoted === -1 ? lines : lines.slice(0, quoted);
  while (kept.length > 0 && /^\s*>/.test(kept.at(-1) ?? "")) {
    kept.pop();
  }
  const body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body.length > MAX_BODY_LENGTH
    ? `${body.slice(0, MAX_BODY_LENGTH - 1)}…`
    : body;
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
