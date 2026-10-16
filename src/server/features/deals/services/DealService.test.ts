import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { runBatch } from "@/db/runBatch";
import type { DealListInput } from "@/types/schemas/deals";

// Deals on both backends: the stage move is a guarded batch, the list
// filters and totals lean on dialect differences (null order, text dates,
// sums), and purge clears rows that have no foreign key.
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
vi.mock("@/db/runBatch", () => ({
  runBatch: (build: Parameters<typeof runBatch>[0]) =>
    databases[current.dialect].runBatch(build),
}));

import { DealRepository } from "../repositories/DealRepository";
import { DealService } from "./DealService";

const A = "org_a";
const B = "org_b";

/** A calendar day `days` from today (UTC), as a close date is written. */
function day(days: number, from = new Date()) {
  const date = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A day early next month (UTC). */
function nextMonth() {
  const now = new Date();
  return day(
    4,
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );
}

const listInput: DealListInput = {
  q: "",
  owner: [],
  archived: false,
  sort: "name",
  dir: "asc",
  status: "all",
  stage: [],
  closing: [],
  page: 1,
  pageSize: 25,
};

const stampRow = z.object({
  stage: z.string(),
  stage_changed_at: z.string(),
  closed_at: z.string().nullable(),
  closed_reason: z.string().nullable(),
  last_activity_at: z.string().nullable(),
});

const moveRow = z.object({
  type: z.string(),
  body: z.string().nullable(),
  meta: z.unknown(),
  company_id: z.string(),
  created_by_id: z.string(),
});

/** A JSON column as read back: jsonb comes parsed, SQLite's text doesn't. */
function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`DealService (${dialect})`, () => {
    const database = databases[dialect];
    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(`
        DELETE FROM agent_event; DELETE FROM agent_task; DELETE FROM activity;
        DELETE FROM deal_contact; DELETE FROM deal; DELETE FROM contact; DELETE FROM company;
        DELETE FROM manual_fx_rate; DELETE FROM fx_rate; DELETE FROM workspace;
        DELETE FROM member; DELETE FROM organization; DELETE FROM "user";
      `);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES
          ('acme', 'org_a', 'Acme'), ('beta', 'org_a', 'Beta Labs'), ('bolt', 'org_b', 'Bolt');
        INSERT INTO manual_fx_rate (organization_id, base_currency, quote_currency, rate, as_of)
          VALUES ('org_a', 'USD', 'EUR', 1.1, '2026-10-01T00:00:00.000Z');
      `);
    });

    const create = (
      name: string,
      input: Partial<Parameters<typeof DealService.createDeal>[1]> = {},
    ) =>
      DealService.createDeal(A, {
        name,
        companyId: "acme",
        ownerId: "user_a",
        ...input,
      });

    const stamps = async () =>
      (
        await database.rows(
          "SELECT stage, stage_changed_at, closed_at, closed_reason, last_activity_at FROM deal",
        )
      ).map((row) => stampRow.parse(row));

    const names = async (input: Partial<DealListInput> = {}) =>
      (await DealService.listDeals(A, { ...listInput, ...input })).rows.map(
        (row) => row.name,
      );

    it("freezes an amount's value in the reporting currency when it's saved, rounded to each currency's minor unit", async () => {
      const euros = await create("Euros", {
        amount: 1000.005,
        currency: "EUR",
      });
      const yen = await create("Yen", { amount: 1234.5, currency: "JPY" });
      // A new rate leaves saved figures alone until the amount changes.
      await database.exec(`UPDATE manual_fx_rate SET rate = 1.2`);
      await DealService.updateDeal(A, { id: euros.id, description: "Renewal" });
      const money = () =>
        database.rows(
          "SELECT amount, currency, base_amount, base_currency, fx_rate FROM deal ORDER BY name",
        );
      expect(await money()).toEqual([
        {
          amount: 1000.01,
          currency: "EUR",
          base_amount: 1100.01,
          base_currency: "USD",
          fx_rate: 1.1,
        },
        {
          amount: 1235,
          currency: "JPY",
          base_amount: null,
          base_currency: null,
          fx_rate: null,
        },
      ]);

      await DealService.updateDeal(A, { id: euros.id, amount: 2000 });
      await DealService.updateDeal(A, { id: yen.id, currency: "USD" });
      expect(await money()).toMatchObject([
        { amount: 2000, base_amount: 2400, fx_rate: 1.2 },
        { amount: 1235, currency: "USD", base_amount: 1235, fx_rate: 1 },
      ]);
      // No currency given: the reporting currency.
      await create("Dollars", { amount: 10 });
      expect(await money()).toContainEqual(
        expect.objectContaining({ currency: "USD", base_amount: 10 }),
      );
    });

    it("moves a deal through its stages, stamping when it closed and filing each move on its timeline", async () => {
      const deal = await create("Renewal");
      await DealService.setStage(
        A,
        { id: deal.id, stage: "CONTRACT_SENT" },
        "user_a",
      );
      await expect(
        DealService.setStage(
          A,
          { id: deal.id, stage: "CLOSED_LOST" },
          "user_a",
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const lost = { id: deal.id, stage: "CLOSED_LOST" as const };
      await DealService.setStage(
        A,
        { ...lost, closedReason: " Incumbent " },
        "user_a",
      );
      const [closed] = await stamps();
      expect(closed?.closed_reason).toBe("Incumbent");
      expect(closed?.closed_at).toBe(closed?.stage_changed_at);
      await expect(DealService.setStage(A, lost, "user_a")).resolves.toEqual({
        ...lost,
        changed: false,
      });
      await DealService.setStage(
        A,
        { id: deal.id, stage: "QUALIFIED_TO_BUY" },
        "user_a",
      );

      const [reopened] = await stamps();
      expect(reopened).toMatchObject({
        stage: "QUALIFIED_TO_BUY",
        closed_at: null,
        closed_reason: null,
        last_activity_at: reopened?.stage_changed_at,
      });
      const moves = await database.rows(
        "SELECT type, body, meta, company_id, created_by_id FROM activity ORDER BY created_at, id",
      );
      expect(
        moves.map((row) => {
          const move = moveRow.parse(row);
          return { ...move, meta: json(move.meta) };
        }),
      ).toEqual([
        {
          type: "STAGE_CHANGE",
          body: null,
          meta: { from: "DEMO_BOOKED", to: "CONTRACT_SENT" },
          company_id: "acme",
          created_by_id: "user_a",
        },
        {
          type: "STAGE_CHANGE",
          body: "Incumbent",
          meta: { from: "CONTRACT_SENT", to: "CLOSED_LOST" },
          company_id: "acme",
          created_by_id: "user_a",
        },
        {
          type: "STAGE_CHANGE",
          body: null,
          meta: { from: "CLOSED_LOST", to: "QUALIFIED_TO_BUY" },
          company_id: "acme",
          created_by_id: "user_a",
        },
      ]);
      expect(
        await database.rows(
          "SELECT last_activity_at FROM company WHERE id = 'acme'",
        ),
      ).toMatchObject([{ last_activity_at: reopened?.stage_changed_at }]);

      // A move from a stage the deal has already left (someone else moved
      // it first) lands nowhere and files nothing.
      expect(
        await DealRepository.moveStage(A, {
          id: deal.id,
          companyId: "acme",
          from: "DEMO_BOOKED",
          to: "CLOSED_WON",
          reason: null,
          movedById: "user_a",
        }),
      ).toBe(false);
      expect(await database.rows("SELECT stage FROM deal")).toMatchObject([
        { stage: "QUALIFIED_TO_BUY" },
      ]);
      expect(await database.rows("SELECT id FROM activity")).toHaveLength(3);
    });

    it("lists the pipeline by name or company, status, stage and close date, with its open value", async () => {
      await create("Renewal", {
        stage: "CONTRACT_SENT",
        amount: 1000,
        expectedCloseDate: day(-2),
      });
      await create("Expansion", {
        companyId: "beta",
        amount: 500,
        currency: "EUR",
        expectedCloseDate: nextMonth(),
      });
      await create("Pilot", { stage: "CLOSED_WON", amount: 300 });
      await create("Swiss", {
        stage: "QUALIFIED_TO_BUY",
        amount: 200,
        currency: "CHF",
        expectedCloseDate: day(0),
      });

      const all = await DealService.listDeals(A, listInput);
      expect(all).toMatchObject({
        total: 4,
        // 1,000 USD and 500 EUR at 1.1; the francs have no rate.
        openValue: 1550,
        reportingCurrency: "USD",
        unconverted: { count: 1, currencies: ["CHF"] },
      });
      expect(await names({ q: "BETA" })).toEqual(["Expansion"]);
      expect(await names({ q: "renew" })).toEqual(["Renewal"]);
      expect(await names({ status: "open" })).toEqual([
        "Expansion",
        "Renewal",
        "Swiss",
      ]);
      expect(await names({ status: "closed" })).toEqual(["Pilot"]);
      expect(await names({ stage: ["CLOSED_WON", "DEMO_BOOKED"] })).toEqual([
        "Expansion",
        "Pilot",
      ]);
      // Due today is not overdue yet.
      expect(await names({ closing: ["overdue"] })).toEqual(["Renewal"]);
      expect(await names({ closing: ["next-month", "none"] })).toEqual([
        "Expansion",
        "Pilot",
      ]);
      expect(await names({ sort: "amount", dir: "desc" })).toEqual([
        "Renewal",
        "Expansion",
        "Pilot",
        "Swiss",
      ]);
      expect(await names({ sort: "stage" })).toEqual([
        "Expansion",
        "Swiss",
        "Renewal",
        "Pilot",
      ]);
      expect(
        await DealService.listDeals(A, { ...listInput, status: "closed" }),
      ).toMatchObject({ openValue: null, unconverted: { count: 0 } });
    });

    it("brings only people from the deal's company onto it, each with a role", async () => {
      const deal = await create("Renewal");
      await database.exec(`
        INSERT INTO contact (id, organization_id, first_name, company_id) VALUES ('ana', 'org_a', 'Ana', 'acme'), ('bo', 'org_a', 'Bo', 'beta');
        INSERT INTO contact (id, organization_id, first_name, company_id, archived_at) VALUES ('old', 'org_a', 'Old', 'acme', '2026-10-01T00:00:00.000Z');
      `);
      const attach = (contactId: string, role?: string | null) =>
        DealService.attachContact(A, { dealId: deal.id, contactId, role });
      const onDeal = async () =>
        (await DealService.getDeal(A, deal.id)).contacts.map(
          ({ id, role }) => ({ id, role }),
        );

      expect(await DealService.contactOptions(A, deal.id)).toMatchObject([
        { id: "ana" },
      ]);
      await expect(attach("bo")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      await expect(attach("old")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await attach("ana", " Champion ");
      await attach("ana");
      expect(await onDeal()).toEqual([{ id: "ana", role: "Champion" }]);
      expect(await DealService.contactOptions(A, deal.id)).toEqual([]);

      await DealService.setContactRole(A, {
        dealId: deal.id,
        contactId: "ana",
        role: " ",
      });
      expect(await onDeal()).toEqual([{ id: "ana", role: null }]);
      await DealService.detachContact(A, deal.id, "ana");
      expect(await onDeal()).toEqual([]);
      await expect(
        DealService.detachContact(A, deal.id, "ana"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("purges only an archived deal, with the agent's rows, and restamps its company", async () => {
      const deal = await create("Renewal");
      await database.exec(`
        INSERT INTO activity (id, organization_id, type, company_id, created_at) VALUES ('older', 'org_a', 'NOTE', 'acme', '2026-01-01T00:00:00.000Z');
        INSERT INTO agent_task (id, organization_id, deal_id, kind, reason, due_at) VALUES ('t1', 'org_a', '${deal.id}', 'field-backfill', 'x', '2026-10-01T00:00:00.000Z');
        INSERT INTO agent_event (id, organization_id, session_id, deal_id, type, data, emitted_at) VALUES ('e1', 'org_a', 's1', '${deal.id}', 'step', '{}', '2026-10-01T00:00:00.000Z');
      `);
      await DealService.setStage(
        A,
        { id: deal.id, stage: "CONTRACT_SENT" },
        "user_a",
      );

      await expect(DealService.purgeDeal(A, deal.id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await DealService.archiveDeal(A, deal.id);
      expect(await names()).toEqual([]);
      expect(await names({ archived: true })).toEqual(["Renewal"]);
      await DealService.purgeDeal(A, deal.id);

      expect(await database.rows("SELECT id FROM deal")).toHaveLength(0);
      expect(
        await database.rows(
          "SELECT id FROM agent_task UNION ALL SELECT id FROM agent_event",
        ),
      ).toHaveLength(0);
      // Its stage change went with it: the company's last activity is its own again.
      expect(
        await database.rows(
          "SELECT last_activity_at FROM company WHERE id = 'acme'",
        ),
      ).toMatchObject([{ last_activity_at: "2026-01-01T00:00:00.000Z" }]);
    });

    it("keeps every deal of one organization out of another's reach", async () => {
      const deal = await create("Renewal", { amount: 100 });
      await database.exec(
        `INSERT INTO contact (id, organization_id, first_name, company_id) VALUES ('ana', 'org_a', 'Ana', 'acme');`,
      );
      await DealService.attachContact(A, { dealId: deal.id, contactId: "ana" });

      expect((await DealService.listDeals(B, listInput)).rows).toEqual([]);
      for (const attempt of [
        DealService.getDeal(B, deal.id),
        DealService.updateDeal(B, { id: deal.id, name: "Mine" }),
        DealService.setStage(B, { id: deal.id, stage: "CLOSED_WON" }, "user_b"),
        DealService.archiveDeal(B, deal.id),
        DealService.contactOptions(B, deal.id),
        DealService.attachContact(B, { dealId: deal.id, contactId: "ana" }),
        DealService.detachContact(B, deal.id, "ana"),
        DealService.setContactRole(B, {
          dealId: deal.id,
          contactId: "ana",
          role: "x",
        }),
        // Another organization's company takes no deal of B's.
        DealService.createDeal(B, {
          name: "x",
          companyId: "acme",
          ownerId: "user_b",
        }),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      // user_b is no member of org_a, and org_b's bulk writes reach nothing.
      await expect(create("x", { ownerId: "user_b" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      for (const result of [
        await DealService.bulkAssignOwner(B, [deal.id], "user_b"),
        await DealService.bulkSetStage(
          B,
          { ids: [deal.id], stage: "CLOSED_WON" },
          "user_b",
        ),
        await DealService.bulkArchive(B, [deal.id]),
        await DealService.bulkPurge(B, [deal.id]),
      ]) {
        expect(result).toMatchObject({ succeeded: 0, failed: 1 });
      }
      expect(await DealService.getDeal(A, deal.id)).toMatchObject({
        name: "Renewal",
        stage: "DEMO_BOOKED",
        owner: { id: "user_a" },
        archivedAt: null,
        contacts: [{ id: "ana" }],
      });
    });
  });
}
