import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { readySite } from "@/server/features/tracking/testing/trackingTestSupport";
import { TrackingSettingsService } from "./TrackingSettingsService";

const A = "org_a";
const B = "org_b";
const ORIGIN = "https://crm.example.com";

function page(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

describe("TrackingSettingsService", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock);
    await database.exec(
      `DELETE FROM tracked_event; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the site its snippet once a domain makes tracking ready", async () => {
    const before = await TrackingSettingsService.getSettings(A, ORIGIN);
    expect(before).toMatchObject({
      ready: false,
      siteId: null,
      snippet: null,
    });

    await TrackingSettingsService.addDomain(A, {
      host: "https://WWW.Acme.com/pricing",
      scope: "EXACT_HOST",
    });
    const after = await TrackingSettingsService.getSettings(A, ORIGIN);
    expect(after.domains).toMatchObject([{ host: "www.acme.com" }]);
    expect(after.siteId).toMatch(/^cmp_[0-9a-f]{16}$/);
    expect(after.snippet).toBe(
      `<script src="${ORIGIN}/t/crm.js" data-site="${after.siteId}" async defer></script>`,
    );
    // The id stays put until it is rotated.
    expect((await TrackingSettingsService.getSettings(A, ORIGIN)).siteId).toBe(
      after.siteId,
    );
  });

  it("keeps each organization's domains its own", async () => {
    const { id } = await TrackingSettingsService.addDomain(A, {
      host: "acme.com",
      scope: "EXACT_HOST",
    });
    await expect(
      TrackingSettingsService.addDomain(A, {
        host: "ACME.com",
        scope: "EXACT_HOST",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The same host is another organization's to add.
    await TrackingSettingsService.addDomain(B, {
      host: "acme.com",
      scope: "EXACT_HOST",
    });
    await expect(
      TrackingSettingsService.removeDomain(B, id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await TrackingSettingsService.getSettings(B, ORIGIN)).domains,
    ).toHaveLength(1);
  });

  it("finds the tag on the page it was redirected to", async () => {
    const siteId = await readySite(A, "acme.com");
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://www.acme.com/" },
        }),
      )
      .mockResolvedValueOnce(
        page(
          `<script src="${ORIGIN}/t/crm.js" data-site="${siteId}"></script>`,
        ),
      );
    expect(await TrackingSettingsService.verify(A, "acme.com")).toMatchObject({
      status: "found",
      host: "www.acme.com",
      allowed: true,
      pageView: false,
      container: null,
    });
  });

  it("reports a Tag Manager tag that loses its site id", async () => {
    const siteId = await readySite(A, "acme.com");
    fetchMock
      .mockResolvedValueOnce(
        page(`<script>(function(){/*GTM-ABC123*/})()</script>`),
      )
      .mockResolvedValueOnce(
        page(`var t='<script src="${ORIGIN}/t/crm.js" data-site="${siteId}">'`),
      );
    expect(await TrackingSettingsService.verify(A, "acme.com")).toMatchObject({
      status: "found",
      container: { id: "GTM-ABC123", carriesSiteId: false },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"),
      expect.anything(),
    );
  });

  it("never follows a redirect off https", async () => {
    await readySite(A, "acme.com");
    await expect(
      TrackingSettingsService.verify(A, "http://acme.com"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest" },
      }),
    );
    expect(await TrackingSettingsService.verify(A, "acme.com")).toEqual({
      status: "unreachable",
      host: "acme.com",
      detail: "The page redirected to plain http.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never fetches an address, typed or redirected to", async () => {
    await readySite(A, "acme.com");
    expect(
      await TrackingSettingsService.verify(A, "https://127.0.0.1/"),
    ).toEqual({
      status: "unreachable",
      host: "127.0.0.1",
      detail: "That is not a public web address.",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest" },
      }),
    );
    expect(await TrackingSettingsService.verify(A, "acme.com")).toEqual({
      status: "unreachable",
      host: "169.254.169.254",
      detail: "That is not a public web address.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
