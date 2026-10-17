import { describe, expect, it, vi } from "vitest";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { database, autumn } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  const { autumnMock } = await import("@/server/billing/autumnTestSupport");
  const testDb = await createSqliteTestDb();
  await testDb.seedTwoOrganizations();
  return { database: testDb, autumn: autumnMock() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/server/billing/autumn", () => ({
  autumn,
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { withBalance } from "./autumnTestSupport";
import { SessionMeter } from "./meter";

/** A session's meter, and a way to wait for what its turns' ends left. */
function session() {
  const pending: Promise<unknown>[] = [];
  const meter = new SessionMeter((promise) => pending.push(promise));
  return { meter, settled: () => Promise.all(pending) };
}

const charges = () => autumn.track.mock.calls.map(([request]) => request);

describe("a CrmAgent session's metering", () => {
  it("bills a chat in $0.05 chunks and the rest when its turn ends, never into debt", async () => {
    withBalance(autumn, 500);
    const { meter, settled } = session();
    expect(
      await meter.admit({
        kind: "chat",
        organizationId: "org_a",
        sessionId: "c.1",
      }),
    ).toBe(false);

    meter.record(0.03);
    // A Sonar search joins the session's total.
    meter.sink({
      provider: "openrouter",
      creditFeature: "crm_agent",
      operation: "web_research",
      costUsd: 0.03,
    });
    meter.record(0.01);
    // The turn ended (onChatResponse, or onChatError).
    meter.flush();
    await settled();

    expect(charges()).toMatchObject([
      {
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: 77,
        overageBehavior: undefined,
        properties: {
          app: "open-crm",
          provider: "openrouter",
          operation: "chat",
          creditFeature: "crm_agent",
          sessionId: "c.1",
        },
      },
      { value: 13, overageBehavior: undefined },
    ]);
  });

  it("refuses a chat turn while the workspace is out of credits", async () => {
    withBalance(autumn, 0);
    const { meter, settled } = session();

    expect(
      await meter.admit({
        kind: "chat",
        organizationId: "org_a",
        sessionId: "c.1",
      }),
    ).toBe(true);
    meter.flush();
    await settled();
    expect(autumn.track).not.toHaveBeenCalled();
  });

  it("bills background work into debt, and a Context.dev call on its own", async () => {
    withBalance(autumn, 50);
    const { meter, settled } = session();
    await meter.admit({
      kind: "research",
      organizationId: "org_a",
      sessionId: "t.1",
    });

    meter.record(0.06);
    meter.sink({
      provider: "context",
      creditFeature: "company_data",
      operation: "brand/retrieve",
      costUsd: 0.025,
    });
    meter.flush();
    await settled();

    // 77 credits against 50 left: the monthly balance goes negative.
    expect(charges()).toMatchObject([
      {
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: 77,
        overageBehavior: "overflow",
        properties: {
          operation: "research",
          creditFeature: "crm_agent",
          sessionId: "t.1",
        },
      },
      {
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: 32,
        overageBehavior: "overflow",
        properties: {
          provider: "context",
          operation: "brand/retrieve",
          creditFeature: "company_data",
        },
      },
    ]);
  });
});
