import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Conversion writes deal amounts with portable SQL (round, cast, upper/trim,
// RETURNING) and upserts rates, so both backends run every case.
const { databases, current } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: { dialect: "sqlite" as "sqlite" | "postgres" },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
  },
}));
vi.mock("@/db", () => ({
  get db() {
    return databases[current.dialect].db;
  },
}));

import { db } from "@/db";
import { deal } from "@/db/schema";
import { ConversionService } from "./ConversionService";
import { CurrencyService } from "./CurrencyService";

const fetchMock = vi.fn<typeof fetch>();

/** The feed's answer for a base: how many of each currency one base buys. */
function feed(rates: Record<string, number>) {
  return Response.json({
    result: "success",
    time_last_update_unix: 1_792_108_800,
    rates,
  });
}

const FEEDS: Record<string, Record<string, number>> = {
  USD: { EUR: 0.8, JPY: 150, XYZ: 3 },
  EUR: { USD: 1.25, JPY: 187.5 },
};

function requestedBase(input: Parameters<typeof fetch>[0]) {
  const url = input instanceof Request ? input.url : input.toString();
  return url.split("/").at(-1) ?? "";
}

const deals = () =>
  db
    .select({
      id: deal.id,
      baseAmount: deal.baseAmount,
      baseCurrency: deal.baseCurrency,
      fxRate: deal.fxRate,
    })
    .from(deal)
    .orderBy(asc(deal.id));

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`CurrencyService (${dialect})`, () => {
    const database = databases[dialect];

    async function seedDeal(
      id: string,
      organizationId: string,
      amount: number,
      currency: string,
      converted: string = "null, null, null",
    ) {
      await database.exec(
        `INSERT INTO deal (id, organization_id, name, company_id, owner_id, amount, currency, base_amount, base_currency, fx_rate)
         VALUES ('${id}', '${organizationId}', '${id}', 'co_${organizationId}', 'user_${organizationId.slice(-1)}', ${amount}, '${currency}', ${converted})`,
      );
    }

    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(
        `DELETE FROM manual_fx_rate; DELETE FROM fx_rate; DELETE FROM deal; DELETE FROM company; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await database.exec(
        `INSERT INTO company (id, organization_id, name) VALUES ('co_org_a', 'org_a', 'A'), ('co_org_b', 'org_b', 'B');`,
      );
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockImplementation(async (input) => {
        const rates = FEEDS[requestedBase(input)];
        return rates ? feed(rates) : Response.json({ result: "error" });
      });
    });

    it("fetches a base currency's rates once a day for every organization, inverted", async () => {
      const settings = await CurrencyService.refreshRates("org_a");
      await CurrencyService.refreshRates("org_b");

      expect(fetchMock).toHaveBeenCalledOnce();
      // One USD buys 0.8 EUR, so one EUR is 1.25 USD; XYZ isn't supported.
      expect(settings.rates).toEqual([
        expect.objectContaining({
          currency: "EUR",
          rate: 1.25,
          source: "FETCHED",
        }),
        expect.objectContaining({
          currency: "JPY",
          rate: 0.0066666667,
          source: "FETCHED",
        }),
      ]);
      expect(settings.refreshedAt).not.toBeNull();
    });

    it("refuses a refresh the feed doesn't answer", async () => {
      fetchMock.mockImplementation(async () =>
        Response.json({ result: "error", "error-type": "unsupported-code" }),
      );

      await expect(CurrencyService.refreshRates("org_a")).rejects.toThrow(
        "Could not reach open.er-api.com",
      );
    });

    it("converts at the organization's own rate over the fetched one, rounded to the reporting currency", async () => {
      await CurrencyService.refreshRates("org_a");
      await CurrencyService.setManualRate("org_a", "EUR", 1.2);

      expect(
        await ConversionService.dealFields("org_a", 1000.005, "EUR"),
      ).toMatchObject({
        baseAmount: 1200.01,
        baseCurrency: "USD",
        fxRate: 1.2,
      });
      // Another organization's own rates never apply.
      expect(
        await ConversionService.dealFields("org_b", 1000.005, "EUR"),
      ).toMatchObject({ baseAmount: 1250.01, fxRate: 1.25 });
      expect(await ConversionService.dealFields("org_a", 10, "CHF")).toEqual({
        baseAmount: null,
        baseCurrency: null,
        fxRate: null,
        fxRateAt: null,
      });
    });

    it("fills in only the deals no rate converted, leaving frozen ones alone", async () => {
      await seedDeal("d1", "org_a", 100, "EUR", "105, 'USD', 1.05");
      await seedDeal("d2", "org_a", 200, "EUR");
      await seedDeal("d3", "org_a", 300, " eur ", "330, 'GBP', 1.1");

      await CurrencyService.setManualRate("org_a", "EUR", 1.2);

      expect(await deals()).toEqual([
        { id: "d1", baseAmount: 105, baseCurrency: "USD", fxRate: 1.05 },
        { id: "d2", baseAmount: 240, baseCurrency: "USD", fxRate: 1.2 },
        { id: "d3", baseAmount: 360, baseCurrency: "USD", fxRate: 1.2 },
      ]);
    });

    it("converts every deal again when the reporting currency changes, and drops those no rate converts", async () => {
      await seedDeal("a1", "org_a", 1000, "USD", "1000, 'USD', 1");
      await seedDeal("a2", "org_a", 500, "EUR", "550, 'USD', 1.1");
      await seedDeal("a3", "org_a", 300, "CHF", "330, 'USD', 1.1");
      await seedDeal("b1", "org_b", 1000, "USD", "1000, 'USD', 1");

      const settings = await CurrencyService.setReportingCurrency(
        "org_a",
        "EUR",
      );

      expect(await deals()).toEqual([
        { id: "a1", baseAmount: 800, baseCurrency: "EUR", fxRate: 0.8 },
        { id: "a2", baseAmount: 500, baseCurrency: "EUR", fxRate: 1 },
        { id: "a3", baseAmount: null, baseCurrency: null, fxRate: null },
        // The other organization still reports in dollars.
        { id: "b1", baseAmount: 1000, baseCurrency: "USD", fxRate: 1 },
      ]);
      expect(settings.unconverted).toEqual({ count: 1, currencies: ["CHF"] });
      expect(settings.inUse).toContainEqual(
        expect.objectContaining({ currency: "CHF", convertible: false }),
      );
    });

    it("refreshes each organization a day after its last refresh", async () => {
      await database.exec(
        `INSERT INTO workspace (organization_id, name) VALUES ('org_a', 'A')`,
      );
      await seedDeal("a1", "org_a", 100, "EUR");
      await CurrencyService.refreshRates("org_b");
      await database.exec(
        `UPDATE fx_rate SET updated_at = '2026-01-01T00:00:00.000Z'`,
      );
      fetchMock.mockClear();

      expect(await CurrencyService.refreshDueRates()).toEqual({
        refreshed: 1,
        failed: 0,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [converted] = await db
        .select({ baseAmount: deal.baseAmount })
        .from(deal)
        .where(eq(deal.id, "a1"));
      expect(converted?.baseAmount).toBe(125);
    });
  });
}
