import { tool } from "ai";
import { z } from "zod";
import { readCapped } from "@/server/features/agent/lib/publicFetch";
import { refusedUrl } from "@/server/lib/publicUrl";

// A team agent reading a public page: the CRM's web_fetch (eve's built-in,
// which its chat read pages with), ported. One https request, refused before
// it leaves for anything refusedUrl names; 30 seconds unless asked for longer
// (at most 120); at most 5 MB; HTML as markdown (the default), as text, or as
// it came. A redirect isn't followed but handed back, so the URL it names is
// checked like any other before it is fetched. The page's head comes back
// within the agent's per-string tool output budget (runtime/toolOutput.ts)
// rather than eve's 50 KB, since every result is re-sent on each later step.
// Free: nothing goes through the gateway.

const MAX_BYTES = 5 * 1024 * 1024;
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

/** The page's text, a line per block, as eve's text format reads it. */
function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\/(p|div|br|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|aside|main|figure|figcaption|details|summary)>/gi,
      "\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

/** The text with its headings, list items and links kept as markdown. */
function htmlToMarkdown(html: string, page: URL): string {
  return htmlToText(
    html
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(
        /<h([1-6])\b[^>]*>/gi,
        (_tag, level: string) => `\n\n${"#".repeat(Number(level))} `,
      )
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "")
      .replace(
        /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
        (_link, _quote, href: string, inner: string) => {
          const label = inner.replace(/<[^>]+>/g, "").trim();
          const target = linkTarget(href, page);
          return label && target ? `[${label}](${target})` : inner;
        },
      ),
  );
}

type Failure = { read: false; reason: string; redirectedTo?: string };

const failed = (reason: string, more: Partial<Failure> = {}): Failure => ({
  read: false,
  reason,
  ...more,
});

async function readPage(input: {
  url: string;
  format?: Format;
  timeout?: number;
}) {
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
    const bytes = await readCapped(response, MAX_BYTES);
    if (!bytes) return failed("The page is empty or larger than 5 MB.");
    const body = new TextDecoder().decode(bytes);
    const content =
      !/html/i.test(type) || format === "html"
        ? body
        : format === "text"
          ? htmlToText(body)
          : htmlToMarkdown(body, url);
    return {
      read: true as const,
      url: url.toString(),
      contentType: type,
      content: content.slice(0, MAX_CHARS),
      truncated: content.length > MAX_CHARS,
    };
  } catch (error) {
    return failed(
      error instanceof Error && error.name === "TimeoutError"
        ? `The page didn't answer in ${seconds} seconds.`
        : "The page could not be reached.",
    );
  }
}

export const webFetch = tool({
  description:
    "Fetch a public web page and return its content: markdown by default, or plain text, or the HTML as it came. The URL must start with https://. A redirect is not followed: fetch the URL it names next. Free. Never put customer text (a pasted thread, a quote from an email) in the URL.",
  inputSchema: z.object({
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
  }),
  execute: (input) => readPage(input),
});
