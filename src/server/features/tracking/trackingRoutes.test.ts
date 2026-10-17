import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/tracking/services/TrackingCollectorService", () => ({
  TrackingCollectorService: { accept: vi.fn(), configForSite: vi.fn() },
}));

import { TrackingCollectorService } from "@/server/features/tracking/services/TrackingCollectorService";
import { MAX_BODY_BYTES } from "@/server/features/tracking/trackingRules";
import { serveTracking } from "./trackingRoutes";

// The collector reads at most MAX_BODY_BYTES before anything parses it, and
// answers 204 whatever it was sent.
describe("POST /t/e", () => {
  const post = (body: string) =>
    serveTracking(
      new Request("https://crm.example.com/t/e", {
        method: "POST",
        body,
        headers: { origin: "https://acme.com", "user-agent": "Mozilla/5.0" },
      }),
    );

  it("hands a batch to the collector with its Origin and user agent", async () => {
    const response = await post('{"siteId":"cmp_0123456789abcdef"}');
    expect(response.status).toBe(204);
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(TrackingCollectorService.accept).toHaveBeenCalledWith(
      '{"siteId":"cmp_0123456789abcdef"}',
      { origin: "https://acme.com", userAgent: "Mozilla/5.0" },
    );
  });

  it("drops a body over the limit unread", async () => {
    const response = await post("x".repeat(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(204);
    expect(TrackingCollectorService.accept).not.toHaveBeenCalled();
  });
});
