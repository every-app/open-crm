import { TrackingCollectorService } from "@/server/features/tracking/services/TrackingCollectorService";
import {
  LOADER_SOURCE,
  trackerSource,
} from "@/server/features/tracking/trackerScripts";
import {
  BUNDLE_MAX_AGE_SECONDS,
  CONFIG_MAX_AGE_SECONDS,
  LOADER_MAX_AGE_SECONDS,
  MAX_BODY_BYTES,
} from "@/server/features/tracking/trackingRules";

// The CRM's only public routes (everyapp.config.ts `public`), which the
// gateway forwards with its signed public marker and no identity:
//
//   GET  /t/crm.js         the loader a website's tag loads
//   GET  /t/<siteId>.js    that site's tracker, config baked in
//   POST /t/e              the collector, always 204
//
// They run on somebody else's website, so they set their own CORS and
// resource-policy headers. They read nothing from the request but the path,
// the body, Origin and User-Agent; the organization comes from the site id.

const COLLECTOR_PATH = "/t/e";
const LOADER_PATH = "/t/crm.js";
const TRACKER_PATH = /^\/t\/([^/]+)\.js$/;

const SCRIPT_HEADERS = {
  "content-type": "application/javascript; charset=utf-8",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
};

/** Whether a path is one of the public tracking routes' (or under them). */
export function isTrackingPath(pathname: string): boolean {
  return pathname.startsWith("/t/");
}

function script(source: string, cacheControl: string): Response {
  return new Response(source, {
    headers: { ...SCRIPT_HEADERS, "cache-control": cacheControl },
  });
}

/** A site with no live tracker loads a script that does nothing. */
function emptyTracker(): Response {
  return script(
    "/* no tracking site is configured */\n",
    "public, max-age=60, s-maxage=60",
  );
}

async function tracker(request: Request, siteId: string): Promise<Response> {
  const site = await TrackingCollectorService.configForSite(siteId);
  if (!site) return emptyTracker();
  const origin = new URL(request.url).origin;
  return script(
    trackerSource(site.config, `${origin}${COLLECTOR_PATH}`),
    `public, max-age=${CONFIG_MAX_AGE_SECONDS}, s-maxage=${CONFIG_MAX_AGE_SECONDS}`,
  );
}

/** The body as text, or null past `limit` bytes (cut off as it streams). */
async function readBody(request: Request, limit: number) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// It answers nothing: a tracker that could read a response is one whose
// failures a stranger can probe. `cross-origin-resource-policy` keeps
// browsers from flagging the beacon's reply on every page view.
function collected(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "cache-control": "no-store",
    },
  });
}

async function collect(request: Request): Promise<Response> {
  try {
    const body = await readBody(request, MAX_BODY_BYTES);
    if (body) {
      await TrackingCollectorService.accept(body, {
        origin: request.headers.get("origin"),
        userAgent: request.headers.get("user-agent"),
      });
    }
  } catch (error) {
    console.error("[tracking] a tracking batch was not stored", error);
  }
  return collected();
}

export async function serveTracking(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === COLLECTOR_PATH) {
    return collect(request);
  }
  if (request.method === "GET" && pathname === LOADER_PATH) {
    return script(
      LOADER_SOURCE,
      `public, max-age=${LOADER_MAX_AGE_SECONDS}, s-maxage=${BUNDLE_MAX_AGE_SECONDS}, immutable`,
    );
  }
  const site = request.method === "GET" ? TRACKER_PATH.exec(pathname) : null;
  if (site?.[1]) return tracker(request, site[1]);
  return new Response("Not found", { status: 404 });
}
