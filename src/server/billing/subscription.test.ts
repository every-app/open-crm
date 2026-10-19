import { describe, expect, it, vi } from "vitest";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { autumn } = await vi.hoisted(async () => ({
  autumn: (await import("@/server/billing/autumnTestSupport")).autumnMock(),
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn,
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { withBalance } from "./autumnTestSupport";
import { checkUsageCredits } from "./subscription";

const customer = { organizationId: "org_a" };

describe("the credit gate", () => {
  it("trusts a reading that covers the work, and refuses only what both read paths confirm falls short", async () => {
    // Monthly credits spent, top-ups left: enough on the first read.
    withBalance(autumn, 0, 400);
    await expect(checkUsageCredits(customer, 192)).resolves.toEqual({
      monthlyRemaining: 0,
      topupRemaining: 400,
    });
    expect(autumn.customers.getOrCreate).not.toHaveBeenCalled();

    // /check reads short, but the customer object shows enough: Autumn
    // served a stale balance, so the work goes ahead on the confirmed
    // reading.
    withBalance(autumn, 100);
    autumn.customers.getOrCreate.mockResolvedValueOnce({
      id: "org_a",
      balances: {
        [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: {
          granted: 1_000,
          remaining: 250,
          nextResetAt: null,
        },
      },
      flags: {},
      subscriptions: [],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkUsageCredits(customer, 192)).resolves.toEqual({
      monthlyRemaining: 250,
      topupRemaining: 0,
    });

    // Both read short.
    await expect(checkUsageCredits(customer, 192)).resolves.toEqual({
      monthlyRemaining: 100,
      topupRemaining: 0,
    });
  });
});
