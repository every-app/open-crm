import { describe, expect, it } from "vitest";
import { parseSocialUrl } from "./socials";

// Only a profile's own page is a candidate: most wrong handles arrive as a
// deep link or a site path that parses like a username.

describe("parseSocialUrl", () => {
  it("reads a profile on X under either name, and on GitHub", () => {
    expect(parseSocialUrl("https://twitter.com/@PaulaM")).toEqual({
      network: "x",
      handle: "paulam",
      url: "https://x.com/PaulaM",
    });
    expect(parseSocialUrl("github.com/paulam")?.url).toBe(
      "https://github.com/paulam",
    );
  });

  it("refuses deep links, site paths and handles neither network issues", () => {
    for (const url of [
      "https://x.com/paulam/status/1234",
      "https://github.com/paulam/crm",
      "https://github.com/pricing",
      "https://x.com/settings",
      "https://x.com/far_too_long_for_x",
      "https://github.com/-paulam",
      "https://linkedin.com/in/paulam",
      "https://x.com/%E0%A4%A",
    ]) {
      expect(parseSocialUrl(url), url).toBeNull();
    }
  });
});
