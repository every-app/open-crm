import { openrouter } from "@openrouter/ai-sdk-provider";
import { tool } from "ai";
import { z } from "zod";
import { fetchPublic, readCapped } from "../lib/publicFetch";
import type { ToolGroup } from "./context";

// The web as the CRM's agent had it. Reading a public page as text, free: the
// stand-in for the CRM's harness web_fetch, which its workspace-profile pass
// reads our own site with. Plain fetch and tag-stripping, as OpenSEO's site
// reader does; a page that needs a browser to render comes back thin, and the
// agent says it could not read it. And searching it: the CRM's web_search.

/**
 * The CRM's web_search, eve's built-in that its model's provider ran (the AI
 * Gateway's Parallel search). Here it is OpenRouter's web search server tool
 * on the same engine with Parallel's ten results, as the builder has it: it
 * searches inside the model call, whose cost includes the search, so the
 * session's meter bills it with the call. The builder's chat uses it too.
 */
export const webSearch = openrouter.tools.webSearch({
  engine: "parallel",
  maxResults: 10,
});

const MAX_PAGE_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 12_000;

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const webTools: ToolGroup = () => ({
  web_search: webSearch,
  web_fetch: tool({
    description:
      "Read a public web page as plain text — a company's own site, its pricing or product page. Free. Never put customer text (a pasted thread, a quote from an email) in the URL.",
    inputSchema: z.object({
      url: z.string().url().describe("The page's full http(s) URL."),
    }),
    execute: async ({ url }) => {
      // A timeout or a refused connection is the same answer as a 404.
      const fetched = await fetchPublic(
        url,
        "text/html,text/plain;q=0.9,*/*;q=0.1",
      ).catch(() => null);
      if (!fetched) {
        return {
          read: false as const,
          reason:
            "The page could not be read. Say so rather than guessing at it.",
        };
      }
      const type = fetched.response.headers.get("content-type") ?? "";
      if (!/^(text\/|application\/(json|xhtml))/i.test(type)) {
        await fetched.response.body?.cancel();
        return {
          read: false as const,
          reason: `That is not a page (${type}).`,
        };
      }
      const bytes = await readCapped(fetched.response, MAX_PAGE_BYTES);
      if (!bytes) {
        return {
          read: false as const,
          reason: "The page is empty or too large.",
        };
      }
      const body = new TextDecoder().decode(bytes);
      const html = /html/i.test(type);
      const title = html
        ? (/<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? null)
        : null;
      const text = html ? htmlToText(body) : body.trim();
      return {
        read: true as const,
        url: fetched.url,
        title: title ? decodeEntities(title) : null,
        text: text.slice(0, MAX_TEXT_CHARS),
        truncated: text.length > MAX_TEXT_CHARS,
      };
    },
  }),
});
