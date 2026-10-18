import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { everyApp } from "@every-app/sdk/server";
import { withPgClient } from "@/db";
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
import { serveImage, IMAGE_ROUTE_PREFIX } from "@/server/lib/images";
import { SLACK_REDIRECT_PATH } from "@/shared/slack";
import { serveEveryAppRequest } from "@/server/lib/gateway-attribution";

const startHandler = createStartHandler(defaultStreamHandler);

// The app ships no security response headers of its own, so any third-party
// page could frame an app route and UI-redress a one-click action (archive a
// company, purge a contact). `frame-ancestors 'self'` on the app's own
// documents is the whole fix, as in OpenSEO.
//
// Only HTML documents, and only ones that carry no policy of their own, so a
// route that sets its own stricter CSP keeps it.
async function appFetch(request: Request): Promise<Response> {
  const response = await startHandler(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !contentType.startsWith("text/html") ||
    response.headers.has("content-security-policy")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function routeAppRequest(
  request: Request,
  env: Env,
): Response | Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // The agent's chats (WebSocket and history) and its Durable Objects. Only
  // the CrmAgent's own prefix: the rest of /agents/* is the team agents' pages.
  if (pathname.startsWith("/agents/crm-agent/")) {
    return routeAgentRequests(request, env);
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
// website tracking routes. Fail closed on anything else before routing. Gateway calls made while serving the request forward its identity
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
      // Website tracking is the CRM's one public surface: the gateway
      // forwards it with no identity (a signed-in member's is ignored), and
      // its organization comes from the site id alone. Nothing else answers
      // a request without one.
      if (isTrackingPath(new URL(verified.url).pathname)) {
        return serveTracking(verified);
      }
      if (!user) return new Response("Not found", { status: 404 });
      return serveEveryAppRequest(verified, user, () =>
        routeAppRequest(verified, env),
      );
    }).fetch(request, env, ctx),
  );
}

function fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Scope a per-request Postgres client (no-op in D1 mode). The client isn't
  // closed here — the Workers↔Hyperdrive socket is reclaimed at invocation end.
  return withPgClient(() => handleRequest(request, env, ctx));
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
    await withPgClient(() => runCron(controller.scheduledTime, env, ctx));
  },
};
