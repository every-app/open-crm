import { beforeEach, describe, expect, it, vi } from "vitest";

// The erasure endpoint is public: it answers nothing until an operator sets
// ERASURE_SECRET, then only to fresh requests signed with it.
const { env } = vi.hoisted(() => ({
  env: { ERASURE_SECRET: undefined as string | undefined },
}));
vi.mock("cloudflare:workers", () => ({ env }));
vi.mock(
  "@/server/features/erasure/services/OrganizationErasureService",
  () => ({
    OrganizationErasureService: {
      inventory: vi.fn(async () => ({ exists: true })),
      eraseNext: vi.fn(),
    },
  }),
);

import { OrganizationErasureService } from "@/server/features/erasure/services/OrganizationErasureService";
import { signErasureRequest } from "@/shared/erasure";
import { serveErasure } from "./erasureRoute";

const SECRET = "test-erasure-secret";
const BODY = JSON.stringify({ organizationId: "org_a", step: "inventory" });

async function post(secret: string, timestamp = String(Date.now())) {
  return serveErasure(
    new Request("https://crm.example.com/internal/erase-organization", {
      method: "POST",
      headers: {
        "content-length": String(BODY.length),
        "x-erasure-timestamp": timestamp,
        "x-erasure-signature": await signErasureRequest(
          secret,
          timestamp,
          BODY,
        ),
      },
      body: BODY,
    }),
  );
}

describe("serveErasure", () => {
  beforeEach(() => {
    env.ERASURE_SECRET = SECRET;
  });

  it("is not there while ERASURE_SECRET is unset", async () => {
    env.ERASURE_SECRET = undefined;
    expect((await post(SECRET)).status).toBe(404);
  });

  it("refuses a request signed with another secret, or signed too long ago", async () => {
    expect((await post("guessed")).status).toBe(401);
    const stale = String(Date.now() - 10 * 60_000);
    expect((await post(SECRET, stale)).status).toBe(401);
    expect(OrganizationErasureService.inventory).not.toHaveBeenCalled();
  });

  it("answers a fresh, signed request", async () => {
    const response = await post(SECRET);
    expect(response.status).toBe(200);
    expect(OrganizationErasureService.inventory).toHaveBeenCalledWith("org_a");
  });
});
