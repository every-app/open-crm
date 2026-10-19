import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/tracking/services/TrackingCollectorService", () => ({
  TrackingCollectorService: { accept: vi.fn(), configForSite: vi.fn() },
}));

import { TrackingCollectorService } from "@/server/features/tracking/services/TrackingCollectorService";
import {
  ADDRESS_SITE_REQUESTS_PER_MINUTE,
  MAX_BODY_BYTES,
} from "@/server/features/tracking/trackingRules";
import { serveTracking } from "./trackingRoutes";

// The collector reads at most MAX_BODY_BYTES before anything parses it, and
// answers 204 whatever it was sent.
describe("POST /t/e", () => {
  const post = (body: string) =>
    serveTracking(
      new Request("https://crm.example.com/t/e", {
        method: "POST",
        body,
        headers: {
          origin: "https://acme.com",
          "user-agent": "Mozilla/5.0",
          "cf-connecting-ip": "203.0.113.7",
        },
      }),
    );

  it("hands a batch to the collector with its Origin, user agent and address", async () => {
    const response = await post('{"siteId":"cmp_0123456789abcdef"}');
    expect(response.status).toBe(204);
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(TrackingCollectorService.accept).toHaveBeenCalledWith(
      '{"siteId":"cmp_0123456789abcdef"}',
      {
        origin: "https://acme.com",
        userAgent: "Mozilla/5.0",
        address: "203.0.113.7",
      },
    );
  });

  it("drops a body over the limit unread", async () => {
    const response = await post("x".repeat(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(204);
    expect(TrackingCollectorService.accept).not.toHaveBeenCalled();
  });
});

describe("GET /t/<siteId>.js", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const get = (ip: string) =>
    serveTracking(
      new Request("https://crm.example.com/t/cmp_0123456789abcdef.js", {
        headers: { "cf-connecting-ip": ip },
      }),
    );

  it("refuses an address past its minute for the site before reading the database, counting an IPv6 client by its /64", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-19T12:00:30Z"),
      toFake: ["Date"],
    });
    for (let host = 1; host <= ADDRESS_SITE_REQUESTS_PER_MINUTE; host += 1) {
      expect((await get(`2001:db8:1:2::${host.toString(16)}`)).status).toBe(
        200,
      );
    }
    expect((await get("2001:db8:1:2:ffff::1")).status).toBe(429);
    expect(TrackingCollectorService.configForSite).toHaveBeenCalledTimes(
      ADDRESS_SITE_REQUESTS_PER_MINUTE,
    );
    expect((await get("2001:db8:1:3::1")).status).toBe(200);
  });
});
