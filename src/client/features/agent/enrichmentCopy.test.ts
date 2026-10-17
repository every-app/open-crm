import { describe, expect, it } from "vitest";
import { dueLabel, queueFooter } from "./enrichmentCopy";

describe("queueFooter", () => {
  it("expands what it fetched before fetching more, and stops at the cap", () => {
    expect(
      queueFooter({ total: 30, fetched: 20, shown: 5, limit: 20 }),
    ).toEqual({ more: 25, action: "show-all" });
    expect(
      queueFooter({ total: 30, fetched: 20, shown: 20, limit: 20 }),
    ).toEqual({ more: 10, action: "load-more" });
    expect(
      queueFooter({ total: 300, fetched: 200, shown: 200, limit: 200 }),
    ).toEqual({ more: 100, action: "none" });
  });
});

describe("dueLabel", () => {
  it("rounds a booking to the nearest sensible unit", () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    const inDays = (days: number) =>
      dueLabel(new Date(now + days * 86_400_000).toISOString(), now);
    expect([1 / 2, 1, 13, 20, 90].map(inDays)).toEqual([
      "Later today",
      "Tomorrow",
      "In 13 days",
      "In 3 weeks",
      "In 3 months",
    ]);
  });
});
