import { beforeEach, describe, expect, it, vi } from "vitest";

// Home's figures are conditional sums, groupings and text-compared dates.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { DashboardService } from "./DashboardService";

/** A SQL literal for an optional text value. */
const text = (value: string | undefined) =>
  value === undefined ? "NULL" : `'${value}'`;

/** The first instant of the UTC month `offset` months from now's. */
function monthStart(offset: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
  ).toISOString();
}

describe("DashboardService", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO "user" (id, name, email) VALUES ('user_c', 'Cy', 'cy@a.test');
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme');
      `);
  });

  /** A USD deal of org_a, converted into USD unless said otherwise. */
  const deal = (
    id: string,
    fields: {
      stage?: string;
      amount?: number;
      currency?: string;
      base?: [number, string] | null;
      owner?: string;
      created?: string;
      closed?: string;
      closes?: string;
      archived?: boolean;
    } = {},
  ) => {
    const amount = fields.amount ?? 1000;
    const base = fields.base === undefined ? [amount, "USD"] : fields.base;
    return database.exec(`
        INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, amount, currency,
          base_amount, base_currency, created_at, closed_at, expected_close_date, archived_at)
        VALUES ('${id}', 'org_a', '${id}', 'acme', '${fields.owner ?? "user_a"}',
          '${fields.stage ?? "DEMO_BOOKED"}', ${amount}, '${fields.currency ?? "USD"}',
          ${base ? base[0] : "NULL"}, ${base ? `'${base[1]}'` : "NULL"},
          ${text(fields.created ?? monthStart(-12))}, ${text(fields.closed)}, ${text(fields.closes)},
          ${fields.archived ? "'2026-01-01T00:00:00.000Z'" : "NULL"})`);
  };

  it("adds up the open pipeline in the reporting currency, disclosing what it can't convert", async () => {
    await deal("demo", { amount: 1000 });
    await deal("contract", {
      stage: "CONTRACT_SENT",
      amount: 2500.5,
      closes: monthStart(0).slice(0, 10),
    });
    await deal("francs", { currency: "CHF", amount: 9000, base: null });
    await deal("stale", { amount: 7000, base: [7000, "EUR"] });
    await deal("archived", { amount: 5000, archived: true });
    await deal("theirs", { amount: 400, owner: "user_c" });

    const mine = await DashboardService.summary("org_a", "user_a", "me");
    expect(mine).toMatchObject({
      firstCompany: { id: "acme", name: "Acme" },
      hasDeals: true,
      multipleOwners: true,
      reportingCurrency: "USD",
      unconverted: { count: 2, currencies: ["CHF", "USD"] },
      pipeline: { total: 3500.5, count: 4 },
      closingThisMonth: { count: 1, value: 2500.5 },
    });
    expect(mine.pipeline.stages).toEqual([
      { stage: "DEMO_BOOKED", count: 3, value: 1000 },
      { stage: "QUALIFIED_TO_BUY", count: 0, value: 0 },
      { stage: "DECISION_MAKER_BOUGHT_IN", count: 0, value: 0 },
      { stage: "CONTRACT_SENT", count: 1, value: 2500.5 },
    ]);
    // A stale figure never takes a place among the biggest deals.
    expect(
      mine.biggestOpen.map((row) => [row.id, row.baseAmount]),
    ).toMatchObject([
      ["contract", 2500.5],
      ["demo", 1000],
      [expect.any(String), null],
      [expect.any(String), null],
    ]);

    const everyone = await DashboardService.summary(
      "org_a",
      "user_a",
      "everyone",
    );
    expect(everyone.pipeline).toMatchObject({ total: 3900.5, count: 5 });
  });

  it("counts wins, losses and the trend from closed deals, averaging only what it can value", async () => {
    const thisMonth = monthStart(0);
    await deal("won", {
      stage: "CLOSED_WON",
      amount: 3000,
      created: monthStart(-1),
      closed: thisMonth,
    });
    await deal("won unvalued", {
      stage: "CLOSED_WON",
      amount: 8000,
      base: [8000, "EUR"],
      created: monthStart(-1),
      closed: thisMonth,
    });
    await deal("won last month", {
      stage: "CLOSED_WON",
      amount: 500,
      created: monthStart(-2),
      closed: monthStart(-1),
    });
    await deal("lost", {
      stage: "CLOSED_LOST",
      created: monthStart(-1),
      closed: thisMonth,
    });

    const summary = await DashboardService.summary("org_a", "user_a", "me");
    expect(summary).toMatchObject({
      multipleOwners: false,
      wonThisMonth: { count: 2, value: 3000 },
      wonLastMonth: { count: 1, value: 500 },
      performance: {
        windowDays: 90,
        wins: 3,
        losses: 1,
        winRate: 0.75,
        averageDeal: 1750,
      },
    });
    expect(summary.trend.map((point) => point.month)).toEqual(
      [-5, -4, -3, -2, -1, 0].map((offset) => monthStart(offset).slice(0, 7)),
    );
    expect(summary.trend.slice(-3)).toEqual([
      { month: monthStart(-2).slice(0, 7), won: 0, created: 500 },
      { month: monthStart(-1).slice(0, 7), won: 500, created: 4000 },
      { month: thisMonth.slice(0, 7), won: 3000, created: 0 },
    ]);
  });

  it("shows my overdue tasks and recent activity, and nothing of another organization", async () => {
    await deal("demo");
    await database.exec(`
        INSERT INTO activity (id, organization_id, type, subject, company_id, deal_id, created_by_id, due_at, created_at) VALUES
          ('late', 'org_a', 'TASK', 'Chase', 'acme', 'demo', 'user_a', '2000-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
          ('later', 'org_a', 'TASK', 'Renew', 'acme', NULL, 'user_a', '2999-01-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'),
          ('note', 'org_a', 'NOTE', 'Theirs', 'acme', NULL, 'user_c', NULL, '2026-10-03T00:00:00.000Z');
      `);

    const mine = await DashboardService.summary("org_a", "user_a", "me");
    expect(mine.overdueTasks.map((task) => task.id)).toEqual(["late"]);
    expect(mine.biggestOpen[0]?.followUpAt).toBe("2000-01-01T00:00:00.000Z");
    expect(mine.recentActivity.map((entry) => entry.id)).toEqual([
      "later",
      "late",
    ]);
    const everyone = await DashboardService.summary(
      "org_a",
      "user_a",
      "everyone",
    );
    expect(everyone.recentActivity.map((entry) => entry.id)).toEqual([
      "note",
      "later",
      "late",
    ]);

    const theirs = await DashboardService.summary(
      "org_b",
      "user_a",
      "everyone",
    );
    expect(theirs).toMatchObject({
      firstCompany: null,
      hasDeals: false,
      multipleOwners: false,
      unconverted: { count: 0 },
      pipeline: { total: 0, count: 0 },
      biggestOpen: [],
      overdueTasks: [],
      recentActivity: [],
    });
  });
});
