import { tool } from "ai";
import { z } from "zod";
import { untrusted } from "@/server/features/agent/tools/untrusted";
import { refusedUrl } from "@/server/lib/publicUrl";

// Reading a public page: the CRM's web_fetch (eve's built-in, which its chat
// read pages with), ported, and the one every session's web_fetch runs on.
// One https request, refused before it leaves for anything refusedUrl names;
// 30 seconds unless asked for longer (at most 120); the page's first 256 KB;
// HTML as markdown (the default), as text, or as it came. A redirect isn't
// followed but handed back, so the URL it names is checked like any other
// before it is fetched. The page's head comes back within the agent's
// per-string tool output budget (runtime/toolOutput.ts) rather than eve's
// 50 KB, since every result is re-sent on each later step, inside the
// envelope that marks it as an outsider's text (agent/tools/untrusted.ts).
// Free: nothing goes through the gateway.

/** The most of a page read: past it, its head is all that comes back. */
const MAX_READ_BYTES = 256 * 1024;
const MAX_CHARS = 8_000;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;

const ACCEPT = {
  markdown:
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
  text: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
  html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1",
} as const;

type Format = keyof typeof ACCEPT;

// Text, and JSON or XML (application/ld+json, application/rss+xml).
const TEXTUAL = /^text\/|^application\/([\w.-]+\+)?(json|xml)\s*(;|$)/i;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2f;": "/",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(amp|gt|lt|nbsp|quot|#39|#x27|#x2f);/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity,
  );
}

/** Elements whose content no reader sees: dropped with it. */
const HIDDEN = new Set(["script", "style", "noscript"]);

/** Elements that end a line when they close, as eve's text format reads one. */
const BLOCKS = new Set([
  "p",
  "div",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "tr",
  "blockquote",
  "pre",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "main",
  "figure",
  "figcaption",
  "details",
  "summary",
]);

/** A link's target, absolute, when it is one a reader could follow. */
function linkTarget(href: string, page: URL): string | null {
  try {
    const target = new URL(decodeEntities(href.trim()), page);
    return ["https:", "http:", "mailto:"].includes(target.protocol)
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}

/** An `<a>` tag's href, read from its first 2,000 characters. */
function hrefOf(tag: string): string | null {
  const head = tag.slice(0, 2_000);
  const found = /\shref\s*=\s*/i.exec(head);
  if (!found) return null;
  const start = found.index + found[0].length;
  const quote = head.charAt(start);
  if (quote === '"' || quote === "'") {
    const end = head.indexOf(quote, start + 1);
    return end === -1 ? null : head.slice(start + 1, end);
  }
  return /^[^\s>]+/.exec(head.slice(start))?.[0] ?? null;
}

/**
 * Puts a link's text, everything written since it opened, back as one
 * markdown link, when it has both text and a target a reader could follow.
 */
function closeLink(
  out: string[],
  link: { target: string | null; start: number },
): void {
  const label = out.slice(link.start).join("").trim();
  if (label && link.target) {
    out.splice(link.start, out.length, `[${label}](${link.target})`);
  }
}

/**
 * The page's text, a line per block; given the page's URL, as markdown, its
 * headings, list items and links kept. One pass over the HTML, each search
 * starting where the last ended, so the time it takes grows with the page's
 * size whatever its markup (the regular expressions this replaces went
 * quadratic on unclosed tags).
 */
function pageText(html: string, page: URL | null): string {
  const out: string[] = [];
  let link: { target: string | null; start: number } | null = null;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) {
      out.push(html.slice(at));
      break;
    }
    out.push(html.slice(at, open));
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      if (end === -1) break;
      at = end + 3;
      continue;
    }
    // A "<" that opens no tag is text.
    const after = html.charAt(open + 1);
    if (!/[a-z/!?]/i.test(after)) {
      out.push("<");
      at = open + 1;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    at = close + 1;
    const ending = after === "/";
    const nameStart = open + (ending ? 2 : 1);
    const name = (
      /^[a-z][a-z0-9]*/i.exec(html.slice(nameStart, nameStart + 12))?.[0] ?? ""
    ).toLowerCase();
    if (!ending && HIDDEN.has(name)) {
      const closer = new RegExp(`</${name}`, "gi");
      closer.lastIndex = at;
      const end = closer.exec(html)?.index;
      if (end === undefined) break;
      const endClose = html.indexOf(">", end);
      at = endClose === -1 ? html.length : endClose + 1;
      continue;
    }
    const heading = page && !ending ? /^h([1-6])$/.exec(name)?.[1] : null;
    if (heading) {
      out.push(`\n\n${"#".repeat(Number(heading))} `);
    } else if (page && name === "li") {
      if (!ending) out.push("\n- ");
    } else if (page && name === "a" && !ending) {
      const href = hrefOf(html.slice(open, close));
      link = { target: href && linkTarget(href, page), start: out.length };
    } else if (page && name === "a") {
      if (link) closeLink(out, link);
      link = null;
    } else if ((ending || name === "br") && BLOCKS.has(name)) {
      out.push("\n");
    }
  }
  return decodeEntities(out.join(""))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first `maxBytes` of the body, and whether there was more. */
async function readHead(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; more: boolean } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (size === 0) return null;
  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes: bytes.subarray(0, maxBytes),
    more: size >= maxBytes,
  };
}

type Failure = { read: false; reason: string; redirectedTo?: string };

const failed = (reason: string, more: Partial<Failure> = {}): Failure => ({
  read: false,
  reason,
  ...more,
});

type PageInput = { url: string; format?: Format; timeout?: number };

async function readPage(input: PageInput) {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return failed("That is not a URL.");
  }
  const refused = await refusedUrl(url);
  if (refused) return failed(refused);
  const format = input.format ?? "markdown";
  const seconds = Math.min(
    input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
    MAX_TIMEOUT_SECONDS,
  );
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(seconds * 1000),
      headers: {
        accept: ACCEPT[format],
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; OpenCRM/1.0)",
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      const next = new URL(location, url).toString();
      return failed(`Redirected to ${next}.`, { redirectedTo: next });
    }
    if (!response.ok) {
      await response.body?.cancel();
      return failed(`The page answered ${response.status}.`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !TEXTUAL.test(type)) {
      await response.body?.cancel();
      return failed(`That is not a page (${type}).`);
    }
    const head = await readHead(response, MAX_READ_BYTES);
    if (!head) return failed("The page is empty.");
    const body = new TextDecoder().decode(head.bytes);
    const content =
      !/html/i.test(type) || format === "html"
        ? body
        : pageText(body, format === "text" ? null : url);
    return {
      read: true as const,
      url: url.toString(),
      contentType: type,
      content: untrusted(content.slice(0, MAX_CHARS), "web page"),
      truncated: head.more || content.length > MAX_CHARS,
    };
  } catch (error) {
    return failed(
      error instanceof Error && error.name === "TimeoutError"
        ? `The page didn't answer in ${seconds} seconds.`
        : "The page could not be reached.",
    );
  }
}

const pageInput = z.object({
  url: z.string().min(1).describe("The page's full https:// URL."),
  format: z
    .enum(["markdown", "text", "html"])
    .optional()
    .describe("markdown (the default), text, or html."),
  timeout: z
    .number()
    .positive()
    .optional()
    .describe("Seconds to wait for the page: 30 by default, at most 120."),
});

export const webFetch = tool({
  description:
    "Fetch a public web page and return its content: markdown by default, or plain text, or the HTML as it came. The URL must start with https://. A redirect is not followed: fetch the URL it names next. Free. Never put customer text (a pasted thread, a quote from an email) in the URL.",
  inputSchema: pageInput,
  execute: (input) => readPage(input),
});
