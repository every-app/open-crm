import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { getWorkersEnv } from "@/server/lib/runtime-env";

// Logos and photographs enrichment copies so they outlive their source: the
// URLs providers hand back expire, and a record that links to them goes
// blank. Each organization's images live under its own prefix in the R2
// bucket, and the record stores the path this module serves them at:
//
//   /api/images/<organizationId>/<name>-<hash>.<ext>
//
// served only to a caller whose verified organization is that one. The key
// hashes the bytes, so a copy is idempotent and a redesigned logo gets a new
// URL, which is why it can be cached for a year.

export const IMAGE_ROUTE_PREFIX = "/api/images/";

const MAX_BYTES = 3 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/**
 * Copies the image at `sourceUrl` into the organization's prefix as
 * `<name>-<hash>.<ext>` and returns the path to store on the record, or null
 * when it could not be fetched, is not an image, or is too large. The Worker
 * reaches public addresses only (`global_fetch_strictly_public`).
 */
export async function storeImage(
  organizationId: string,
  name: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    if (new URL(sourceUrl).protocol !== "https:") return null;
    const bucket: unknown = Reflect.get((await getWorkersEnv()) ?? {}, "R2");
    if (!isBucket(bucket)) return null;
    const response = await fetch(sourceUrl, {
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    const extension = type ? EXTENSIONS[type] : undefined;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !type || !extension || declared > MAX_BYTES) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    const key = `${organizationId}/${name}-${hash}.${extension}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
    return `${IMAGE_ROUTE_PREFIX}${key.split("/").map(encodeURIComponent).join("/")}`;
  } catch (error) {
    console.warn("[images] could not copy an image", {
      reason: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

function isBucket(value: unknown): value is R2Bucket {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "put") === "function"
  );
}

/** `<organizationId>/<rest>` from a request path, refusing traversal. */
function keyFromPath(
  pathname: string,
): { organizationId: string; value: string } | null {
  if (!pathname.startsWith(IMAGE_ROUTE_PREFIX)) return null;
  let segments: string[];
  try {
    segments = pathname
      .slice(IMAGE_ROUTE_PREFIX.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        /[/\\]/.test(segment),
    )
  ) {
    return null;
  }
  return { organizationId: segments[0] ?? "", value: segments.join("/") };
}

/**
 * Serves a stored image to a member of the organization that owns it. Anyone
 * else gets the same 404 as a missing image, so a path says nothing about
 * another organization.
 */
export async function serveImage(
  request: Request,
  bindings: { R2: R2Bucket },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const key = keyFromPath(new URL(request.url).pathname);
  if (!key) return notFound();
  let organizationId: string;
  try {
    ({ organizationId } = await resolveUserContextFromHeaders(request.headers));
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (organizationId !== key.organizationId) return notFound();
  const object = await bindings.R2.get(key.value);
  if (!object) return notFound();
  const headers = new Headers({
    "content-type":
      object.httpMetadata?.contentType ?? "application/octet-stream",
    // Private: only this organization's members may read it. Immutable: the
    // key hashes the bytes.
    "cache-control": "private, max-age=31536000, immutable",
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
    // A stored SVG opened directly runs nothing.
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  if (request.headers.get("if-none-match") === object.httpEtag) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
