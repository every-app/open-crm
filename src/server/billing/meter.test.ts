import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  OUT_OF_CREDITS_REPLY,
} from "@/shared/billing";

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

/** A person's chat turn in org_a. */
const chat = (sessionId: string) => ({
  kind: "chat" as const,
  organizationId: "org_a",
  sessionId,
});

const heldSlots = () => database.rows("SELECT session_id FROM paid_session");

describe("a CrmAgent session's metering", () => {
  beforeEach(async () => {
    await database.exec("DELETE FROM paid_session");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bills a chat in $0.05 chunks and the rest when its turn ends, past zero too", async () => {
    withBalance(autumn, 200);
    const { meter, settled } = session();
    expect(await meter.admit(chat("c.1"))).toBeNull();

    meter.record(0.03);
    // A Sonar search joins the session's total.
    meter.sink({
      provider: "openrouter",
      creditFeature: "crm_agent",
      operation: "web_research",
      costUsd: 0.03,
    });
    meter.record(0.15);
    meter.record(0.01);
    // The turn ended (onChatResponse, or onChatError).
    meter.flush();
    await settled();

    // 282 credits against 200 left: the monthly balance goes negative.
    expect(charges()).toMatchObject([
      {
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: 77,
        overageBehavior: "overflow",
        properties: {
          app: "open-crm",
          provider: "openrouter",
          operation: "chat",
          creditFeature: "crm_agent",
          sessionId: "c.1",
        },
      },
      { value: 192, overageBehavior: "overflow" },
      { value: 13, overageBehavior: "overflow" },
    ]);
    // Its slot is free for the next turn.
    expect(await heldSlots()).toEqual([]);
  });

  it("refuses a chat turn the workspace's credits can't cover", async () => {
    // A turn may cost 192 credits.
    withBalance(autumn, 150);
    const { meter, settled } = session();

    expect(await meter.admit(chat("c.1"))).toBe(OUT_OF_CREDITS_REPLY);
    meter.flush();
    await settled();
    expect(autumn.track).not.toHaveBeenCalled();
    expect(await heldSlots()).toEqual([]);
  });

  it("answers three of a workspace's chats at once, and a fourth waits a minute for one to end", async () => {
    vi.useFakeTimers();
    withBalance(autumn, 5_000);
    const answering = [session(), session(), session()];
    for (const [index, { meter }] of answering.entries()) {
      expect(await meter.admit(chat(`c.${index}`))).toBeNull();
    }

    let waited = true;
    const fourth = session()
      .meter.admit(chat("c.3"))
      .finally(() => {
        waited = false;
      });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(waited).toBe(true);
    // One ends: the fourth takes its slot.
    answering[0].meter.flush();
    await answering[0].settled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await fourth).toBeNull();

    // None ends for a minute: the next gives up.
    const fifth = session().meter.admit(chat("c.4"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await fifth).toBe(
      "Other chats in this workspace are still answering. Try again in a minute.",
    );
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
