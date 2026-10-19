import { env } from "cloudflare:workers";
import { z } from "zod";
import { OrganizationErasureService } from "@/server/features/erasure/services/OrganizationErasureService";
import { signErasureRequest } from "@/shared/erasure";

// The operator's erasure endpoint (src/shared/erasure.ts), a public route
// because no operator is a member of the organization being erased. It
// answers 404 unless ERASURE_SECRET is set, and only to a request signed
// with it in the last five minutes, as OpenSEO's GDPR erasure endpoint.
// The runbook sets the secret for an erasure and unsets it afterwards.

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_BODY_BYTES = 4_096;

const requestSchema = z.discriminatedUnion("step", [
  z.object({
    organizationId: z.string().min(1).max(256),
    step: z.literal("inventory"),
  }),
  z.object({
    organizationId: z.string().min(1).max(256),
    step: z.literal("erase"),
    confirm: z.string(),
  }),
]);

/** Compares in time independent of where the strings differ. */
function sameText(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function signed(request: Request, body: string, secret: string) {
  const timestamp = request.headers.get("x-erasure-timestamp") ?? "";
  const signature = request.headers.get("x-erasure-signature") ?? "";
  const at = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(at)) return false;
  if (Math.abs(Date.now() - at) > MAX_CLOCK_SKEW_MS) return false;
  return sameText(signature, await signErasureRequest(secret, timestamp, body));
}

export async function serveErasure(request: Request): Promise<Response> {
  const secret = env.ERASURE_SECRET?.trim();
  if (!secret) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  // The body is read before it is checked, so bound it first.
  const length = Number(request.headers.get("content-length") ?? "NaN");
  if (!Number.isInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
    return new Response("Content-Length required, at most 4 KB", {
      status: 411,
    });
  }
  const body = await request.text();
  if (!(await signed(request, body, secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  let parsed;
  try {
    parsed = requestSchema.safeParse(JSON.parse(body));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;
  if (input.step === "erase" && input.confirm !== input.organizationId) {
    return Response.json(
      { error: "confirm must be the organization id" },
      { status: 400 },
    );
  }
  try {
    const result =
      input.step === "inventory"
        ? await OrganizationErasureService.inventory(input.organizationId)
        : await OrganizationErasureService.eraseNext(input.organizationId);
    return Response.json({ ok: true, result });
  } catch (error) {
    // The operator reads the reason, fixes it and runs the step again.
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[erasure] a step failed", {
      organizationId: input.organizationId,
      step: input.step,
    });
    return Response.json({ error: reason }, { status: 500 });
  }
}
