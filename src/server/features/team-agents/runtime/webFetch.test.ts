import { describe, expect, it, vi } from "vitest";

// Reading a page, as the CRM's chat did with web_fetch: an https page comes
// back as markdown with its links followable, inside the envelope that marks
// an outsider's text; anything that isn't a public name (a private or local
// address, the Every App gateway and the app hosts under it) is refused
// before a request leaves; and a redirect is handed back rather than
// followed, so the URL it names is checked too.
vi.mock("cloudflare:workers", () => ({
  env: { EVERYAPP_IDENTITY_ISSUER: "https://gateway.example.test" },
}));

import { webFetch } from "./webFetch";

const read = (url: string) =>
  webFetch.execute?.({ url }, { toolCallId: "call", messages: [] });

describe("web_fetch", () => {
  it("reads an https page as markdown, its links absolute", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<html><head><title>Acme pricing</title><style>h1{}</style></head>
        <body><h1>Pricing</h1><p>Plans for every team &amp; budget.</p>
        <ul><li>Starter</li><li>Pro</li></ul>
        <a href="/plans/pro">See <b>Pro</b></a><script>track()</script></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );
    expect(await read("https://acme.test/pricing")).toEqual({
      read: true,
      url: "https://acme.test/pricing",
      contentType: "text/html; charset=utf-8",
      content:
        '<untrusted-data source="web page">\nAcme pricing\n\n# Pricing\nPlans for every team & budget.\n\n- Starter\n- Pro\n[See Pro](https://acme.test/plans/pro)\n</untrusted-data>',
      truncated: false,
    });
  });

  it("reads a page's first 256 KB in one pass, however broken its markup", async () => {
    // Unclosed links, comments and scripts: what the regular expressions it
    // replaced took minutes over, each searching to the end of the page.
    const broken = '<a href="/x">x <!-- <script>'.repeat(40_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<p>Pricing</p><a href="/y">y${broken}`, {
        headers: { "content-type": "text/html" },
      }),
    );
    expect(await read("https://acme.test/pricing")).toMatchObject({
      read: true,
      content:
        '<untrusted-data source="web page">\nPricing\nyx\n</untrusted-data>',
      truncated: true,
    });
  });

  it("refuses private, local and gateway addresses without fetching them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const urls = [
      "http://acme.test/",
      "https://10.0.0.8/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://localhost:8787/",
      "https://crm.localhost/",
      "https://intranet/",
      "https://gateway.example.test/",
      "https://crm.gateway.example.test/api/images/org_a/logo.png",
    ];
    const reasons = [];
    for (const url of urls) reasons.push(await read(url));
    expect(reasons).toEqual([
      { read: false, reason: "Only https:// pages can be read." },
      ...Array.from({ length: 6 }, () => ({
        read: false,
        reason: "That is not a public web address.",
      })),
      { read: false, reason: "That address is on the Every App gateway." },
      { read: false, reason: "That address is on the Every App gateway." },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hands a redirect back instead of following it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 301, headers: { location: "/pricing" } }),
      );
    expect(await read("https://acme.test/plans")).toEqual({
      read: false,
      reason: "Redirected to https://acme.test/pricing.",
      redirectedTo: "https://acme.test/pricing",
    });
    // The runtime never follows one itself, unchecked.
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      new URL("https://acme.test/plans"),
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
