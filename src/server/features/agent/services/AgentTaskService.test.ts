import { beforeEach, describe, expect, it, vi } from "vitest";

// A company a person adds gets its favicon at once, as the CRM fetched it
// (companies.service.ts): free, so not after its brand, nor held while the
// workspace is out of credits as the brand is.
const { database, r2, deferred } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return {
    database: await createSqliteTestDb(),
    r2: { put: vi.fn<(key: string, value: unknown) => Promise<void>>() },
    deferred: [] as Promise<unknown>[],
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", R2: r2 },
  waitUntil: (work: Promise<unknown>) => deferred.push(work),
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
// The first-party deployment, which bills.
const { autumn } = await vi.hoisted(async () => ({
  autumn: (await import("@/server/billing/autumnTestSupport")).autumnMock(),
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn,
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { withBalance } from "@/server/billing/autumnTestSupport";
import { AgentTaskService } from "./AgentTaskService";

describe("a company a person adds", () => {
  beforeEach(async () => {
    deferred.length = 0;
    // Its site serves an icon at /favicon.ico, and nothing else.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (!url.endsWith("/favicon.ico")) {
          return new Response(null, { status: 404 });
        }
        return new Response(
          init?.method === "HEAD" ? null : new Uint8Array([0, 0, 1, 0]),
          { headers: { "content-type": "image/x-icon" } },
        );
      }),
    );
    await database.exec(
      `DELETE FROM agent_task; DELETE FROM company; DELETE FROM workspace; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO company (id, organization_id, name, domain) VALUES ('acme', 'org_a', 'Acme', 'acme.test');`,
    );
  });

  it("gets its favicon at once, while its brand waits for credits", async () => {
    withBalance(autumn, 0);
    await AgentTaskService.companyAddedByPerson("org_a", "acme");
    await Promise.all(deferred);

    const [company] = await database.rows("SELECT icon_url FROM company");
    expect(company?.icon_url).toMatch(
      /^\/api\/images\/org_a\/companies\/acme\/icon-\w+\.ico$/,
    );
    expect(
      await database.rows(
        "SELECT kind, finished_at FROM agent_task WHERE kind = 'brand'",
      ),
    ).toEqual([{ kind: "brand", finished_at: null }]);
  });
});
