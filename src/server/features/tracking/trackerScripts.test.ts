import { brotliCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LOADER_SOURCE, trackerSource } from "./trackerScripts";

// Settings promise a 4 KB tag, and the scripts are hand-written ES5 in
// template literals that nothing else parses before a customer's page does.
describe("tracker scripts", () => {
  const tracker = trackerSource(
    {
      siteId: "cmp_0123456789abcdef",
      crossDomain: true,
      limitToDomains: true,
      cookieSubdomains: false,
      secureCookies: true,
      honourDnt: true,
      cookieDays: 395,
      hosts: [{ host: "acme.com", scope: "SITE_AND_SUBDOMAINS" }],
    },
    "https://crm.example.com/t/e",
  );

  it("are valid JavaScript within their size budget", () => {
    for (const source of [LOADER_SOURCE, tracker]) {
      // oxlint-disable-next-line typescript/no-implied-eval -- parses the scripts without running them
      expect(() => new Function(source)).not.toThrow();
    }
    expect(brotliCompressSync(LOADER_SOURCE).byteLength).toBeLessThanOrEqual(
      1024,
    );
    expect(brotliCompressSync(tracker).byteLength).toBeLessThanOrEqual(4096);
  });
});
