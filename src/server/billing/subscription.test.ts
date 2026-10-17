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
import { checkUsageCreditsDepleted } from "./subscription";

const customer = { organizationId: "org_a" };

describe("the credit gate", () => {
  it("admits any positive balance and refuses only a ≤ 0 both read paths confirm", async () => {
    // Monthly credits spent, top-ups left: admitted on the first read.
    withBalance(autumn, 0, 400);
    await expect(checkUsageCreditsDepleted(customer)).resolves.toEqual({
      depleted: false,
      monthlyRemaining: 0,
    });
    expect(autumn.customers.getOrCreate).not.toHaveBeenCalled();

    // /check reads 0, but the customer object shows credits: Autumn served a
    // stale balance, so the work goes ahead on the confirmed reading.
    withBalance(autumn, 0);
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
    await expect(checkUsageCreditsDepleted(customer)).resolves.toEqual({
      depleted: false,
      monthlyRemaining: 250,
    });

    // Both agree: out of credits.
    await expect(checkUsageCreditsDepleted(customer)).resolves.toMatchObject({
      depleted: true,
    });
  });
});
