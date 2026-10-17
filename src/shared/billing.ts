// OpenSEO's billing constants and credit math (its src/shared/billing.ts),
// verbatim: the CRM bills the same Autumn account, so the plans, features
// and markup are OpenSEO's and an organization's credits are one balance
// across OpenSEO, the CRM and, later, the Every App gateway. "SEO data" in
// the names is OpenSEO's history; the pool is every app's.

/** Settings → Billing, shown on a deployment that bills (server/billing). */
export const SETTINGS_BILLING_ROUTE = "/settings/billing";

export type PlanStatus = "free" | "paid";

export const AUTUMN_PAID_PLAN_ID = "base-plan";
// YC deal: same entitlements as the base plan with $50 of monthly credits.
export const AUTUMN_YC_PLAN_ID = "yc-plan";
export const AUTUMN_SEO_DATA_TOP_UP_PLAN_ID = "credit-top-up";
export const AUTUMN_PAID_PLAN_FEATURE_ID = "paid_plan";
// The shared usage-credit pool. Every paid call deducts from these (monthly
// usage_credits first, then rolled-over topup_credits).
export const AUTUMN_SEO_DATA_BALANCE_FEATURE_ID = "usage_credits";
export const AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID = "topup_credits";
export const AUTUMN_SEO_DATA_CREDITS_PER_USD = 1000;
const SEO_DATA_COST_MARKUP = 1.28;
export const LOW_CREDITS_THRESHOLD_USD = 0.25;

// Passed through to Stripe's checkout.sessions.create so checkout collects the
// legal business name, tax ID (EU VAT etc.), and full billing address — makes
// invoices valid for business customers. Display only, no Stripe Tax. Stripe
// requires customer_update.name "auto" to collect tax IDs for an existing customer.
export const AUTUMN_CHECKOUT_SESSION_PARAMS = {
  tax_id_collection: { enabled: true },
  billing_address_collection: "required",
  customer_update: { name: "auto", address: "auto" },
} as const;

function roundUsdForBilling(value: number) {
  return Math.round(value * 100000) / 100000;
}

export function autumnSeoDataCreditsToUsd(credits: number) {
  return credits / AUTUMN_SEO_DATA_CREDITS_PER_USD;
}

/**
 * Convert a raw provider USD cost into the USD amount a hosted customer is
 * actually billed, applying the platform markup.
 */
export function applyBillingMarkupUsd(rawUsd: number): number {
  return roundUsdForBilling(rawUsd * SEO_DATA_COST_MARKUP);
}

/**
 * Credits charged for one raw provider USD cost: marked-up, rounded, then
 * ceiled per call. This is the single charging formula.
 */
export function creditsForProviderUsd(rawUsd: number): number {
  return Math.ceil(
    applyBillingMarkupUsd(rawUsd) * AUTUMN_SEO_DATA_CREDITS_PER_USD,
  );
}
