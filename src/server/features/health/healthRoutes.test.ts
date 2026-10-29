import { beforeEach, describe, expect, it, vi } from "vitest";

// The health check at its route, against a real database.
const { database, current } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    current: { databaseDown: false },
  };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  get db() {
    if (current.databaseDown) {
      return {
        select: () => {
          throw new Error("connection refused");
        },
      };
    }
    return database.db;
  },
}));

import { serveHealth } from "./healthRoutes";

describe("the health check", () => {
  beforeEach(() => {
    current.databaseDown = false;
  });

  it("says whether the database answers, and nothing else", async () => {
    const up = await serveHealth();
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ status: "ok", database: "up" });

    current.databaseDown = true;
    const down = await serveHealth();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: "error", database: "down" });
  });
});
