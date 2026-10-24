import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { everyApp, type EveryAppUser } from "@every-app/sdk/server";
import { runCron } from "@/server/cron";
import { withoutCookies } from "@/server/everyapp/cookies";
import { routeAgentRequests } from "@/server/features/agent/agentRoutes";
import {
  isTrackingPath,
  serveTracking,
} from "@/server/features/tracking/trackingRoutes";
import { handleSlackCallback } from "@/server/features/slack/routes/callback";
import {
  ATTACHMENT_ROUTE_PREFIX,
  serveAttachment,
} from "@/server/features/team-agents/routes/attachments";
import {
  DISPATCH_HEALTH_PATH,
  HEALTH_PATH,
  serveDispatchHealth,
  serveHealth,
} from "@/server/features/health/healthRoutes";
import { serveImage, IMAGE_ROUTE_PREFIX } from "@/server/lib/images";
import { serveErasure } from "@/server/features/erasure/erasureRoute";
import { ERASURE_PATH } from "@/shared/erasure";
import { SLACK_REDIRECT_PATH } from "@/shared/slack";
import { serveEveryAppRequest } from "@/server/lib/gateway-attribution";

const startHandler = createStartHandler(defaultStreamHandler);

// The app's own documents carry a policy of their own (the gateway adds its
// floor, base-uri and object-src, to whatever an app sends):
//
// - `frame-ancestors 'self'`, so no third-party page can frame an app route
//   and UI-redress a one-click action (archive a company, purge a contact),
//   as in OpenSEO;
// - `img-src`, only what the app shows: its own copies, attachments and
//   icons, data: and blob: URLs (an attachment previewed before it is sent),
//   and the hosts Context.dev's pictures come from until they are copied
//   (agent/lib/people.ts). Nothing on a page can load an image from an
//   address it chose, and so send data out in its URL;
// - `script-src`: the app's own scripts, and inline ones only with this
//   response's nonce, which TanStack Start puts on its hydration scripts
//   (router.tsx) and __root.tsx on the theme script. An injected inline
//   script or event handler doesn't run.
//
// Only HTML documents, and only ones that carry no policy of their own, so a
// route that sets its own stricter CSP keeps it.
const APP_CSP = [
  "frame-ancestors 'self'",
  "img-src 'self' data: blob: https://*.brand.dev https://*.context.dev https://*.licdn.com",
].join("; ");

async function appFetch(request: Request): Promise<Response> {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const response = await startHandler(request, { context: { nonce } });
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !contentType.startsWith("text/html") ||
    response.headers.has("content-security-policy")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    `${APP_CSP}; script-src 'self' 'nonce-${nonce}'`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function routeAppRequest(
  request: Request,
  env: Env,
  user: EveryAppUser,
): Response | Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // The agent's chats (WebSocket and history) and its Durable Objects. Only
  // the CrmAgent's own prefix: the rest of /agents/* is the team agents' pages.
  if (pathname.startsWith("/agents/crm-agent/")) {
    return routeAgentRequests(request, env);
  }
  // The dispatcher's health check, for an owner or admin.
  if (pathname === DISPATCH_HEALTH_PATH) {
    return serveDispatchHealth(user);
  }
  // Logos and photographs the agent copied into R2.
  if (pathname.startsWith(IMAGE_ROUTE_PREFIX)) {
    return serveImage(request, env);
  }
  // Files attached in a builder chat, for the chat's owner.
  if (pathname.startsWith(ATTACHMENT_ROUTE_PREFIX)) {
    return serveAttachment(request);
  }
  // Slack's redirect back after an owner or admin connected it.
  if (pathname === SLACK_REDIRECT_PATH) {
    return handleSlackCallback(request);
  }
  return appFetch(request);
}

// The CRM is private behind an Every App gateway, which signs the person's
// identity onto every request it forwards, or its public marker onto the
// website tracking routes. Fail closed on anything else before routing.
// Gateway calls made while serving the request forward its identity
// (gateway-attribution.ts). The gateway's MCP tool calls
// (`/__everyapp/tools/*`, the CRM's API: docs/maintainers/mcp.md) load the
// tools on first use only.
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (new URL(request.url).pathname.startsWith("/__everyapp/")) {
    const { everyAppTools } = await import("@/server/everyapp/tools");
    return everyAppTools.fetch(request, env, ctx);
  }
  return withoutCookies(
    await everyApp<Env>((verified, _env, _ctx, user) => {
      // Website tracking is the CRM's public surface: the gateway forwards
      // it with no identity (a signed-in member's is ignored), and its
      // organization comes from the site id alone. The health check reads no
      // identity either (it says only whether the Worker and its database
      // answer) but is not public: the gateway forwards it signed in or with
      // a personal access token. Nothing else answers without an identity
      // but the erasure route below.
      if (isTrackingPath(new URL(verified.url).pathname)) {
        return serveTracking(verified);
      }
      if (new URL(verified.url).pathname === HEALTH_PATH) return serveHealth();
      // An operator erasing an organization: signed, and 404 unless armed.
      if (new URL(verified.url).pathname === ERASURE_PATH) {
        return serveErasure(verified);
      }
      if (!user) return new Response("Not found", { status: 404 });
      return serveEveryAppRequest(verified, user, () =>
        routeAppRequest(verified, env, user),
      );
    }).fetch(request, env, ctx),
  );
}

function fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return handleRequest(request, env, ctx);
}

// The research agent's Durable Object class (Agents SDK).
export { CrmAgent } from "./server/features/agent/CrmAgent";

export default {
  fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    // The minute cron (src/server/cron.ts): the agent's dispatcher, and the
    // hourly and daily upkeep. It calls no provider on anyone's behalf
    // without naming the organization the work is for
    // (gateway-attribution.ts).
    await runCron(controller.scheduledTime, env, ctx);
  },
};
