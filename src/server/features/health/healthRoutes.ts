import { hasScope, type EveryAppUser } from "@every-app/sdk/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseSize } from "@/db/maintenance";
import { workspace } from "@/db/schema";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import { DispatchHealthService } from "@/server/features/agent/services/DispatchHealthService";
import { hasOrgPermission } from "@/shared/org-permissions";

// The CRM's health checks, as the CRM had them (apps/api/src/health, and its
// agent's /internal/crm/dispatch-health):
//
// - GET /health is public (everyapp.config.ts) and cheap: one query, to say
//   whether the Worker and its database answer. No counts, nothing anyone's.
// - GET /health/dispatch is the dispatcher's, for monitoring. The gateway
//   turns away anyone not signed in before the CRM sees the request, as the
//   CRM's agent turned away a caller without its secret. An owner or admin
//   reads it with their session or a personal access token for the CRM
//   holding `*` or the `health` scope, and sees their own organization's
//   work only, and the database's size.

export const HEALTH_PATH = "/health";
export const DISPATCH_HEALTH_PATH = "/health/dispatch";

/** A database probe slower than this is logged, as the CRM logged it. */
const SLOW_PROBE_MS = 250;

export async function serveHealth(): Promise<Response> {
  const startedAt = Date.now();
  try {
    await db
      .select({ one: sql`1` })
      .from(workspace)
      .limit(1);
  } catch (error) {
    console.error("[health] database health check failed", error);
    return json({ status: "error", database: "down" }, 503);
  }
  const durationMs = Date.now() - startedAt;
  if (durationMs > SLOW_PROBE_MS) {
    console.warn("[health] database health check was slow", {
      durationMs,
      thresholdMs: SLOW_PROBE_MS,
    });
  }
  return json({ status: "ok", database: "up" }, 200);
}

export async function serveDispatchHealth(
  user: EveryAppUser,
): Promise<Response> {
  let context;
  try {
    context = await resolveEveryAppUserContext(user);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (
    !hasScope(user, "health") ||
    !hasOrgPermission(context.role, { workspace: ["manage"] })
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const health = await DispatchHealthService.forOrganization(
    context.organizationId,
  );
  // The organization's owners run its database too, and D1 refuses every
  // write once it is full.
  const database = await databaseSize();
  return json({ ...health, database }, health.ok ? 200 : 503);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
