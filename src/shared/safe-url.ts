/**
 * Validate a URL string against an http(s) scheme allow-list. The one check
 * for every external URL the app renders as `<a href>` or exports as a link.
 *
 * The URLs come from DataForSEO (mostly safe but still external), Search
 * Console, or LLM responses (untrusted — a crafted prompt can coax a model
 * into emitting `javascript:`/`data:` payloads). Without this filter, those
 * links are clickable from inside an authenticated session.
 *
 * Returns the URL string unchanged if its protocol is `http:` or `https:`,
 * otherwise null. Callers should drop null entries before rendering.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Reject `user:pass@host` — the hostname the user sees in link text may
    // differ from where the browser authenticates.
    if (url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * An http(s) address as a person types one, given https when it has no
 * scheme ("linkedin.com/in/ana"), or null when it isn't one.
 */
export function normalizeUrl(raw: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  const safe = safeHttpUrl(withScheme);
  if (!safe) return null;
  return new URL(safe).hostname.includes(".") ? safe : null;
}

/**
 * Extract the bare hostname (without leading `www.`) from a URL string,
 * returning null if the URL is invalid or uses a non-http(s) scheme.
 */
export function safeHostname(value: string | null | undefined): string | null {
  const url = safeHttpUrl(value);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
