import { sql } from "drizzle-orm";
import { db } from "@/db";
import { workspace } from "@/db/schema";

// The CRM's health check, as the CRM had it (apps/api/src/health). GET
// /health is private like the rest of the CRM (a signed-in member or a
// personal access token reaches it; the gateway's own /health is the public
// liveness check) and cheap: one query, to say whether the Worker and its
// database answer. No counts, nothing anyone's.

export const HEALTH_PATH = "/health";

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

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
