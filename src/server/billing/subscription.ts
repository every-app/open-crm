import { AppError } from "@/server/lib/errors";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  applyBillingMarkupUsd,
  creditsForProviderUsd,
} from "@/shared/billing";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { autumn, AUTUMN_TRACK_RETRY_OPTIONS } from "./autumn";

// OpenSEO's organization billing (its src/server/billing/subscription.ts):
// the Autumn customer, the credit gate, and after-the-fact deductions. The
// Autumn customer id is the gateway organization id, the same customer
// OpenSEO bills.

/** Whose credits: the organization, and the person acting, when there is one. */
export type BillingCustomer = {
  organizationId: string;
  userEmail?: string | null;
};

// Existence is monotonic and the customer id is always the organization id,
// so once confirmed the round trip is skipped. OpenSEO keeps this in KV; the
// CRM keeps it for the isolate's life (a Durable Object's, for its turns).
const ensuredCustomers = new Set<string>();

/**
 * Makes sure the organization's Autumn customer (and its default free-plan
 * credits) exists, or a new organization's first gate reads "no balance".
 */
export async function getOrCreateOrganizationCustomer(
  customer: BillingCustomer,
): Promise<void> {
  if (ensuredCustomers.has(customer.organizationId)) return;
  const created = await autumn.customers.getOrCreate({
    customerId: customer.organizationId,
    email: customer.userEmail ?? undefined,
  });
  if (!created.id) {
    throw new AppError("INTERNAL_ERROR", "Failed to resolve billing customer");
  }
  ensuredCustomers.add(customer.organizationId);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Remaining shared usage credits: the monthly `usage_credits` balance plus the
// rolled-over `topup_credits` balance.
export async function getUsageCreditsRemaining(customerId: string): Promise<{
  monthlyRemaining: number;
  topupRemaining: number;
}> {
  const [monthlyCheck, topupCheck] = await Promise.all([
    autumn.check({ customerId, featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID }),
    autumn.check({
      customerId,
      featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    }),
  ]);

  // Autumn sometimes returns a successful response with no monthly balance
  // for a customer that holds the feature. Retry that read once because the
  // SDK's retry policy only covers failed HTTP requests.
  let monthlyBalance = monthlyCheck.balance;
  if (!monthlyBalance) {
    await sleep(300);
    const retry = await autumn.check({
      customerId,
      featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    });
    monthlyBalance = retry.balance;
  }

  // Every hosted organization holds the monthly feature (the free plan is the
  // Autumn default, attached at customer creation), so a check with no
  // balance data is a broken read, not an empty wallet. Throwing keeps it out
  // of the credit math. The top-up balance genuinely doesn't exist until a
  // first top-up, so 0 is the honest reading there.
  if (!monthlyBalance) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Autumn check returned no ${AUTUMN_SEO_DATA_BALANCE_FEATURE_ID} balance for customer ${customerId}`,
    );
  }

  // A missing optional top-up denies access; allowed with no balance is the
  // SDK's fail-open response, so the total is unknown rather than base-only.
  if (topupCheck.allowed && !topupCheck.balance) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Autumn check returned no ${AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID} balance for customer ${customerId}`,
    );
  }

  return {
    monthlyRemaining: monthlyBalance.remaining,
    topupRemaining: topupCheck.balance?.remaining ?? 0,
  };
}

/**
 * The credit gate. A /check reading ≤ 0 is not trusted on its own: Autumn
 * has served a stale balance transiently (minutes after a free→paid
 * upgrade), and a false refusal locks the customer out. When the check reads
 * depleted, confirm against the full customer object — a separate Autumn
 * read path — and refuse only when both agree. A disagreement means Autumn
 * served inconsistent balances: the work proceeds on the confirmed reading
 * and the inconsistency is logged at error level.
 */
export async function checkUsageCreditsDepleted(
  customer: BillingCustomer,
): Promise<{ depleted: boolean; monthlyRemaining: number }> {
  const check = await getUsageCreditsRemaining(customer.organizationId);
  if (check.monthlyRemaining + check.topupRemaining > 0) {
    return { depleted: false, monthlyRemaining: check.monthlyRemaining };
  }

  // No try/catch: if this second read fails while the first said depleted,
  // the whole gate errors rather than guessing — the work fails generically
  // and retryably instead of refusing with a possibly-false paywall.
  const full = await autumn.customers.getOrCreate({
    customerId: customer.organizationId,
    email: customer.userEmail ?? undefined,
  });
  const confirmed = {
    monthlyRemaining:
      full.balances[AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]?.remaining ?? 0,
    topupRemaining:
      full.balances[AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]?.remaining ?? 0,
  };

  if (confirmed.monthlyRemaining + confirmed.topupRemaining > 0) {
    console.error(
      "billing.credits-gate disagreement: /check read depleted but the " +
        "customer object shows credits; proceeding on the customer reading",
      { organizationId: customer.organizationId, check, confirmed },
    );
    return { depleted: false, monthlyRemaining: confirmed.monthlyRemaining };
  }
  return { depleted: true, monthlyRemaining: check.monthlyRemaining };
}

/**
 * Deducts a USD provider cost from the organization's shared usage-credit
 * pool after the fact: applies the platform markup, converts to credits, and
 * spends monthly `usage_credits` first, then `topup_credits`. Pass
 * `monthlyRemaining` from the reading that gated the work.
 */
export async function trackUsageCreditSpend(args: {
  organizationId: string;
  creditFeature: CreditFeature;
  costUsd: number;
  monthlyRemaining: number;
  /**
   * Admitted background work spends available top-ups, then overdraws
   * monthly credits. Every hosted organization has a monthly balance; a
   * top-up balance may not exist yet.
   */
  overdraft?: { topupRemaining: number };
  properties: Record<string, unknown>;
}): Promise<{ monthlyCredits: number; topupCredits: number }> {
  const totalCostUsd = applyBillingMarkupUsd(args.costUsd);
  const totalCostCredits = creditsForProviderUsd(args.costUsd);
  if (totalCostCredits <= 0) return { monthlyCredits: 0, topupCredits: 0 };

  // Clamp at 0: Autumn balances can read negative after an overdraft, and a
  // negative monthly reading here would inflate the topup deduction.
  let monthlyDeduct = Math.min(
    Math.max(args.monthlyRemaining, 0),
    totalCostCredits,
  );
  let topupDeduct = totalCostCredits - monthlyDeduct;
  if (args.overdraft) {
    topupDeduct = Math.min(
      topupDeduct,
      Math.max(args.overdraft.topupRemaining, 0),
    );
    monthlyDeduct = totalCostCredits - topupDeduct;
  }

  const properties = {
    currency: "USD",
    creditFeature: args.creditFeature,
    totalCostUsd,
    totalCostCredits,
    ...args.properties,
  };
  const deductions = [
    [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID, monthlyDeduct],
    [AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID, topupDeduct],
  ] as const;
  for (const [featureId, value] of deductions) {
    if (value <= 0) continue;
    await autumn.track(
      {
        customerId: args.organizationId,
        featureId,
        value,
        // Background work explicitly permits debt; Autumn otherwise caps at
        // zero.
        overageBehavior: args.overdraft ? "overflow" : undefined,
        properties: { ...properties, balanceFeatureId: featureId },
      },
      AUTUMN_TRACK_RETRY_OPTIONS,
    );
  }
  return { monthlyCredits: monthlyDeduct, topupCredits: topupDeduct };
}
