import { vi } from "vitest";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";
import type { AutumnClient } from "./autumn";

/**
 * Autumn's client for a test that mocks it at its module:
 *
 *   const { autumn } = await vi.hoisted(async () => ({
 *     autumn: (await import("@/server/billing/autumnTestSupport")).autumnMock(),
 *   }));
 *   vi.mock("@/server/billing/autumn", () => ({
 *     autumn,
 *     AUTUMN_TRACK_RETRY_OPTIONS: {},
 *   }));
 */
export function autumnMock() {
  return {
    check: vi.fn<AutumnClient["check"]>(),
    track: vi.fn<AutumnClient["track"]>(),
    customers: {
      getOrCreate: vi.fn<AutumnClient["customers"]["getOrCreate"]>(),
    },
  };
}

const balance = (remaining: number) => ({
  granted: 1_000,
  remaining,
  nextResetAt: null,
});

/**
 * Every organization holds `monthly` usage credits and `topUp` top-up
 * credits, on both of Autumn's read paths; usage is accepted.
 */
export function withBalance(
  autumn: ReturnType<typeof autumnMock>,
  monthly: number,
  topUp = 0,
) {
  autumn.check.mockImplementation(async ({ featureId }) =>
    featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID
      ? { allowed: monthly > 0, balance: balance(monthly) }
      : { allowed: topUp > 0, balance: topUp > 0 ? balance(topUp) : null },
  );
  autumn.customers.getOrCreate.mockImplementation(async ({ customerId }) => ({
    id: customerId,
    balances: {
      [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: balance(monthly),
      [AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]: balance(topUp),
    },
    flags: {},
    subscriptions: [],
  }));
  autumn.track.mockResolvedValue({});
}
