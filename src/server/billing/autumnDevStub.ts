import {
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_PAID_PLAN_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";
import type { AutumnClient } from "./autumn";

// Local dev's stand-in for Autumn (AUTUMN_DEV_STUB in .dev.vars, read only
// under `everyapp dev`): the organization in one fixed state, so the hosted
// screens and gates can be seen without an Autumn key. Nothing is charged
// and nothing changes: usage is dropped, and checkout comes straight back.

const DAY_MS = 86_400_000;

// Credits (1,000 to the dollar) in each state.
const STATES: Record<
  string,
  { paid: boolean; granted: number; monthly: number; topUp: number }
> = {
  free: { paid: false, granted: 1_000, monthly: 640, topUp: 0 },
  paid: { paid: true, granted: 10_000, monthly: 7_310, topUp: 12_500 },
  low: { paid: false, granted: 1_000, monthly: 180, topUp: 0 },
  out: { paid: false, granted: 1_000, monthly: 0, topUp: 0 },
};

export function autumnDevStub(name: string): AutumnClient {
  const state = STATES[name] ?? STATES.free;
  const monthly = {
    granted: state.granted,
    remaining: state.monthly,
    nextResetAt: state.paid ? Date.now() + 12 * DAY_MS : null,
  };
  const topUp = state.topUp
    ? { granted: state.topUp, remaining: state.topUp, nextResetAt: null }
    : undefined;
  return {
    check: async ({ featureId }) => {
      if (featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID) {
        return { allowed: monthly.remaining > 0, balance: monthly };
      }
      if (featureId === AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID) {
        return { allowed: Boolean(topUp), balance: topUp ?? null };
      }
      return {
        allowed: featureId === AUTUMN_PAID_PLAN_FEATURE_ID && state.paid,
        balance: null,
      };
    },
    track: async () => ({}),
    customers: {
      getOrCreate: async ({ customerId }) => ({
        id: customerId,
        balances: {
          [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: monthly,
          [AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]: topUp,
        },
        flags: state.paid
          ? { [AUTUMN_PAID_PLAN_FEATURE_ID]: { planId: AUTUMN_PAID_PLAN_ID } }
          : {},
        subscriptions: state.paid
          ? [{ planId: AUTUMN_PAID_PLAN_ID, pastDue: false, canceledAt: null }]
          : [],
      }),
    },
    events: {
      aggregate: async () => ({
        list: [
          {
            groupedValues: {
              [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: {
                crm_agent: 1_840,
                company_data: 620,
                keyword_research: 410,
              },
            },
          },
        ],
        total: { [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: { sum: 2_870 } },
      }),
    },
    billing: {
      attach: async ({ successUrl }) => ({ paymentUrl: successUrl ?? null }),
      openCustomerPortal: async ({ returnUrl }) => ({ url: returnUrl ?? "/" }),
    },
  };
}
