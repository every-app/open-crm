import { fetchPublic } from "./publicFetch";

// A company's own favicon, the free logo the CRM fell back on when
// Context.dev had none (the CRM's packages/db/src/favicon.ts): the icons the
// home page declares (`icon`, `shortcut icon`, `apple-touch-icon`), the
// largest declared size first, then /favicon.ico. The first that answers as
// an image wins, at whatever size the site serves it.

const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;
const MAX_ICON_CANDIDATES = 10;

const ICON_REL = /^(shortcut )?icon$|^apple-touch-icon(-precomposed)?$/i;

function iconsFromHtml(html: string, base: URL): string[] {
  const found: { href: string; size: number }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.trim();
    if (!rel || !ICON_REL.test(rel)) continue;
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.trim();
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    try {
      found.push({
        href: new URL(href, base).toString(),
        size: Number(sizes ?? 0),
      });
    } catch {
      // Not a URL; skip it.
    }
  }
  return found.sort((a, b) => b.size - a.size).map((icon) => icon.href);
}

/** The home page's first MAX_HTML_BYTES, and where it was served from. */
async function readPage(url: URL): Promise<{ body: string; url: URL } | null> {
  const fetched = await fetchPublic(url.toString(), "text/html", {
    timeoutMs: TIMEOUT_MS,
  });
  if (!fetched) return null;
  const { response } = fetched;
  if (!(response.headers.get("content-type") ?? "").includes("html")) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (bytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { body, url: new URL(fetched.url) };
}

async function servesImage(url: string): Promise<boolean> {
  const fetched = await fetchPublic(url, "image/*", {
    method: "HEAD",
    timeoutMs: TIMEOUT_MS,
  });
  if (!fetched) return false;
  await fetched.response.body?.cancel();
  return (fetched.response.headers.get("content-type") ?? "").startsWith(
    "image/",
  );
}

/** The URL of the domain's favicon, or null when it serves none. */
export async function resolveFavicon(domain: string): Promise<string | null> {
  try {
    const base = new URL(`https://${domain}`);
    const page = await readPage(base).catch(() => null);
    const candidates = page
      ? iconsFromHtml(page.body, page.url).slice(0, MAX_ICON_CANDIDATES)
      : [];
    candidates.push(new URL("/favicon.ico", page?.url ?? base).toString());
    for (const candidate of candidates) {
      if (await servesImage(candidate).catch(() => false)) return candidate;
    }
  } catch {
    // An unreachable or malformed site has no favicon to offer.
  }
  return null;
}
