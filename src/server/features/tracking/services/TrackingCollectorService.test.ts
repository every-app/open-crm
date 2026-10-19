import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The collector is the CRM's one anonymous write path: each refusal must
// happen for the reason its test names, the rate counts in the database,
// and a site id only ever writes into its own organization.
const { database, pinned } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    pinned: { organizationId: undefined as string | undefined },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get EVERY_APP_ORG_ID() {
      return pinned.organizationId;
    },
  },
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
vi.mock("@/server/features/agent/poke", () => ({ pokeDispatcher: vi.fn() }));

import {
  batch,
  pageView,
  readySite,
} from "@/server/features/tracking/testing/trackingTestSupport";
import { TrackingEventRepository } from "@/server/features/tracking/repositories/TrackingEventRepository";
import { TrackingSiteRepository } from "@/server/features/tracking/repositories/TrackingSiteRepository";
import { TrackingSettingsService } from "@/server/features/tracking/services/TrackingSettingsService";
import {
  ADDRESS_SITE_REQUESTS_PER_MINUTE,
  dayWindow,
  minuteWindow,
  ORG_EVENTS_PER_DAY,
  SITE_EVENTS_PER_MINUTE,
} from "@/server/features/tracking/trackingRules";
import { TrackingCollectorService } from "./TrackingCollectorService";

const A = "org_a";
const B = "org_b";
const BROWSER = {
  origin: "https://www.acme.com",
  userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
};

describe("TrackingCollectorService", () => {
  let siteId: string;
  beforeEach(async () => {
    pinned.organizationId = undefined;
    await database.exec(
      `DELETE FROM tracking_counter; DELETE FROM tracked_event; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    siteId = await readySite(A, "acme.com");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const events = () =>
    database.rows(
      "SELECT organization_id, type, host, path, referrer, source, medium FROM tracked_event ORDER BY path",
    );

  it("records page views and clicks from an allowed page, without query strings", async () => {
    await TrackingCollectorService.accept(
      batch(siteId, [
        pageView("www.acme.com", {
          path: "/reset?token=secret#x",
          referrer: "https://www.google.co.uk/search?q=acme",
          touch: { referrer: "https://www.google.co.uk/search?q=acme" },
        }),
        {
          type: "click",
          host: "www.acme.com",
          path: "/pricing",
          label: "Book a demo",
        },
      ]),
      BROWSER,
    );
    expect(await events()).toEqual([
      {
        organization_id: A,
        type: "click",
        host: "www.acme.com",
        path: "/pricing",
        referrer: null,
        source: null,
        medium: null,
      },
      {
        organization_id: A,
        type: "page_view",
        host: "www.acme.com",
        path: "/reset",
        referrer: "https://www.google.co.uk/search",
        source: "Google",
        medium: "organic",
      },
    ]);
    expect(
      await database.rows("SELECT host, page_views FROM tracked_domain"),
    ).toEqual([{ host: "acme.com", page_views: 1 }]);
  });

  it("refuses a bot's user agent", async () => {
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      {
        ...BROWSER,
        userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)",
      },
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a site id that rotation retired", async () => {
    await TrackingSettingsService.rotateSiteId(A);
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a paused site", async () => {
    await TrackingSettingsService.setFlag(A, "paused", true);
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a site of another organization than the pinned one", async () => {
    pinned.organizationId = B;
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a POST without an Origin even with the allow-list off", async () => {
    await TrackingSettingsService.setFlag(A, "limitToDomains", false);
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      { ...BROWSER, origin: null },
    );
    expect(await events()).toEqual([]);
  });

  it("refuses an Origin off the allow-list", async () => {
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      { ...BROWSER, origin: "https://acme.com.evil.example" },
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a malformed visitor id", async () => {
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")], "short"),
      BROWSER,
    );
    expect(await events()).toEqual([]);
  });

  it("refuses a replay: three events with one timestamp", async () => {
    const at = Date.now() - 1_000;
    await TrackingCollectorService.accept(
      batch(siteId, [
        pageView("acme.com", { at, path: "/a" }),
        pageView("acme.com", { at, path: "/b" }),
        pageView("acme.com", { at, path: "/c" }),
      ]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
  });

  it("drops the events of a host off the allow-list and keeps the rest", async () => {
    await TrackingCollectorService.accept(
      batch(siteId, [
        pageView("acme.com", { path: "/kept" }),
        pageView("other.example", { path: "/dropped" }),
      ]),
      BROWSER,
    );
    expect(await database.rows("SELECT path FROM tracked_event")).toEqual([
      { path: "/kept" },
    ]);
  });

  it("refuses a batch past the site's minute, and charges it nothing", async () => {
    const window = minuteWindow(new Date());
    const key = `site:${window.key}`;
    await TrackingEventRepository.take(
      A,
      key,
      SITE_EVENTS_PER_MINUTE,
      SITE_EVENTS_PER_MINUTE - 1,
      window.expiresAt,
    );
    await TrackingCollectorService.accept(
      batch(siteId, [
        pageView("acme.com", { path: "/a" }),
        pageView("acme.com", { path: "/b" }),
      ]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
    // The refused pair spent nothing: one event still fits.
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com", { path: "/c" })]),
      BROWSER,
    );
    expect(await database.rows("SELECT path FROM tracked_event")).toEqual([
      { path: "/c" },
    ]);
  });

  it("refuses an address past its minute for a site, before reading the database", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-19T12:00:30Z"),
      toFake: ["Date"],
    });
    const lookups = vi.spyOn(TrackingSiteRepository, "findBySiteId");
    const unknownSite = batch("cmp_ffffffffffffffff", [pageView("acme.com")]);
    // The limiter's memory outlives a test: each backend its own address.
    const from = {
      ...BROWSER,
      address: "198.51.100.1",
    };
    for (let sent = 0; sent < ADDRESS_SITE_REQUESTS_PER_MINUTE; sent += 1) {
      await TrackingCollectorService.accept(unknownSite, from);
    }
    await TrackingCollectorService.accept(unknownSite, from);
    expect(lookups).toHaveBeenCalledTimes(ADDRESS_SITE_REQUESTS_PER_MINUTE);
    // Another address still gets through.
    await TrackingCollectorService.accept(unknownSite, {
      ...from,
      address: "203.0.113.9",
    });
    expect(lookups).toHaveBeenCalledTimes(ADDRESS_SITE_REQUESTS_PER_MINUTE + 1);
  });

  it("refuses events past the organization's day, and charges them nothing", async () => {
    const day = dayWindow(new Date());
    await TrackingEventRepository.take(
      A,
      `day:${day.key}`,
      ORG_EVENTS_PER_DAY,
      ORG_EVENTS_PER_DAY,
      day.expiresAt,
    );
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com")]),
      BROWSER,
    );
    expect(await events()).toEqual([]);
    expect(await database.rows("SELECT key FROM tracking_counter")).toEqual([
      { key: `day:${day.key}` },
    ]);
  });

  it("writes a site id's events into its own organization only", async () => {
    const siteB = await readySite(B, "acme.com");
    await TrackingCollectorService.accept(
      batch(siteId, [pageView("acme.com", { path: "/for-a" })]),
      BROWSER,
    );
    await TrackingCollectorService.accept(
      batch(siteB, [pageView("acme.com", { path: "/for-b" })]),
      BROWSER,
    );
    expect(
      await database.rows(
        "SELECT organization_id, path FROM tracked_event ORDER BY path",
      ),
    ).toEqual([
      { organization_id: A, path: "/for-a" },
      { organization_id: B, path: "/for-b" },
    ]);
    expect(
      (await TrackingSettingsService.getSettings(B, "https://crm.test"))
        .pageViews,
    ).toBe(1);
  });
});
