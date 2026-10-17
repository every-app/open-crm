import { sort } from "remeda";
import { AppError } from "@/server/lib/errors";
import {
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  autumnSeoDataCreditsToUsd,
  type PlanStatus,
} from "@/shared/billing";
import { creditFeatureLabel } from "@/shared/billing-credit-features";
import { autumn } from "./autumn";
import { CreditReadingRepository } from "./creditReading";
import type { BillingCustomer } from "./subscription";

// What Settings → Billing shows, ported from OpenSEO's billing-account.ts and
// usage.ts.

/** The organization's plan and credits, as the billing screens show them. */
type BillingAccount = {
  planStatus: PlanStatus;
  /** The plan that granted the paid entitlement. Null on the free plan and
   *  for paid access granted by hand. */
  paidPlanId: string | null;
  /** What the plan grants each month, in USD. */
  monthlyCreditsUsd: number;
  monthlyRemainingUsd: number;
  topUpRemainingUsd: number;
  /** When the monthly credits refill, in epoch ms. Null for the free plan's
   *  one-time credits and for a paid plan canceled at period end, which ends
   *  then instead of refilling. */
  monthlyRefillsAt: number | null;
};

export async function getOrganizationBillingAccount(
  customer: BillingCustomer,
): Promise<BillingAccount> {
  const found = await autumn.customers.getOrCreate({
    customerId: customer.organizationId,
    email: customer.userEmail ?? undefined,
  });

  // The SDK fails open on Autumn 5xx and network errors with an empty
  // customer that has no id. Showing it would tell a paying customer they are
  // on the free plan with $0, so surface the outage instead.
  if (!found.id) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Autumn returned no billing customer",
    );
  }

  const paidFlag = found.flags[AUTUMN_PAID_PLAN_FEATURE_ID];
  const paidSubscription = found.subscriptions.find(
    (subscription) => subscription.planId === paidFlag?.planId,
  );
  const monthly = found.balances[AUTUMN_SEO_DATA_BALANCE_FEATURE_ID];
  const topUp = found.balances[AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID];

  // Credits bought lift a hold on the agent's work at once, rather than when
  // the hold lapses (creditReading.ts). Only ever lifts: this one read never
  // confirms an organization out of credits.
  if ((monthly?.remaining ?? 0) + (topUp?.remaining ?? 0) > 0) {
    await CreditReadingRepository.note(customer.organizationId, false);
  }

  return {
    // Autumn names the plan that granted `paid_plan`, so every plan configured
    // to grant it counts as paid without listing plan IDs here.
    planStatus: paidFlag ? "paid" : "free",
    paidPlanId: paidFlag?.planId ?? null,
    monthlyCreditsUsd: autumnSeoDataCreditsToUsd(monthly?.granted ?? 0),
    monthlyRemainingUsd: autumnSeoDataCreditsToUsd(monthly?.remaining ?? 0),
    topUpRemainingUsd: autumnSeoDataCreditsToUsd(topUp?.remaining ?? 0),
    monthlyRefillsAt: paidSubscription?.canceledAt
      ? null
      : (monthly?.nextResetAt ?? null),
  };
}

const USAGE_FEATURE_IDS = [
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
];

/**
 * The organization's usage over the last 30 days by what it was for, in
 * USD, most first: every app's, since the credits are one balance.
 */
export async function getOrganizationBillingUsage(organizationId: string) {
  const usage = await autumn.events.aggregate({
    customerId: organizationId,
    featureId: USAGE_FEATURE_IDS,
    range: "30d",
    // Every billed usage event names its feature here. More groups than
    // credit features, so Autumn never folds one into its own "Other".
    groupBy: "properties.creditFeature",
    maxGroups: 20,
  });

  const creditsByLabel = new Map<string, number>();
  const addCredits = (label: string, credits: number) =>
    creditsByLabel.set(label, (creditsByLabel.get(label) ?? 0) + credits);
  let groupedCredits = 0;
  for (const bin of usage.list) {
    for (const featureId of USAGE_FEATURE_IDS) {
      const groups = bin.groupedValues?.[featureId] ?? {};
      for (const [feature, credits] of Object.entries(groups)) {
        addCredits(creditFeatureLabel(feature), credits ?? 0);
        groupedCredits += credits ?? 0;
      }
    }
  }
  // Grouping drops events without a credit feature; they count as Other.
  const totalCredits = USAGE_FEATURE_IDS.reduce(
    (sum, featureId) => sum + (usage.total[featureId]?.sum ?? 0),
    0,
  );
  addCredits("Other", totalCredits - groupedCredits);

  // Refunds can leave a feature at or below zero; those rows are hidden.
  return sort(
    [...creditsByLabel]
      .map(([label, credits]) => ({
        label,
        usd: autumnSeoDataCreditsToUsd(credits),
      }))
      .filter((row) => row.usd > 0),
    (a, b) => b.usd - a.usd,
  );
}
