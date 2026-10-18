// A GET (or HEAD) of a public http(s) URL for the agent's own reads (a page,
// a logo, a photograph). Redirects are followed by hand, at most three, so
// each hop is checked again; the Worker's global_fetch_strictly_public flag
// keeps every hop off private addresses. Null for anything that is not a 2xx
// answer.

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export async function fetchPublic(
  url: string,
  accept: string,
  options: { method?: "GET" | "HEAD"; timeoutMs?: number } = {},
): Promise<{ response: Response; url: string } | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (target.protocol !== "https:" && target.protocol !== "http:")
      return null;
    if (target.username || target.password) return null;
    const response = await fetch(target, {
      method: options.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      headers: {
        accept,
        "user-agent": "Mozilla/5.0 (compatible; OpenCRM/1.0)",
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = new URL(location, target);
      continue;
    }
    if (response.ok) return { response, url: target.toString() };
    await response.body?.cancel();
    return null;
  }
  return null;
}

/** The body, or null when it is larger than `maxBytes`. */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (size === 0 || size > maxBytes) return null;
  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
