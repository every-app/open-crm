import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";

// Logos and photographs the research agent the CRM used to have copied so
// they outlive their source. Nothing copies new ones; records still point at
// these. Each organization's images live under its own prefix in the R2
// bucket, and the record stores the path this module serves them at:
//
//   /api/images/<organizationId>/<name>-<hash>.<ext>
//
// served only to a caller whose verified organization is that one. The key
// hashes the bytes, so a copy is idempotent and a redesigned logo gets a new
// URL, which is why it can be cached for a year.

export const IMAGE_ROUTE_PREFIX = "/api/images/";

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
