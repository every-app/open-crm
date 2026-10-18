import { describe, expect, it, vi } from "vitest";

// The agent's own reads (pages, logos, photographs) follow redirects by hand,
// so a page can't send one to an address or to the Every App gateway: that
// hop is refused, never fetched.
vi.mock("cloudflare:workers", () => ({
  env: { EVERYAPP_IDENTITY_ISSUER: "https://gateway.example.test" },
}));

import { fetchPublic } from "./publicFetch";

describe("fetchPublic", () => {
  it.each([
    "https://crm.gateway.example.test/api/images/org_a/logo.png",
    "http://169.254.169.254/latest/meta-data",
  ])("doesn't follow a redirect to %s", async (location) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location } }),
      );
    expect(
      await fetchPublic("https://acme.test/logo.png", "image/*"),
    ).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
