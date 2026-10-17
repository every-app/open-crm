import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AppError } from "@/server/lib/errors";
import {
  AUTUMN_CHECKOUT_SESSION_PARAMS,
  AUTUMN_PAID_PLAN_ID,
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  AUTUMN_SEO_DATA_TOP_UP_PLAN_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  SETTINGS_BILLING_ROUTE,
} from "@/shared/billing";
import { autumn } from "./autumn";

// OpenSEO's checkout (its src/server/billing/checkout.ts). Every Autumn
// request is built here from fixed plan ids and server-chosen parameters:
// the client sends only a bounded top-up amount. Each returns a URL for the
// browser to open, and only the owner may make one.

type BillingCaller = Pick<EnsuredUserContext, "organizationId" | "role">;

// redirectMode "always" makes Autumn return a link instead of billing: Stripe
// Checkout, or Autumn's own confirmation page for a customer who already
// subscribes. Nothing is charged until the customer confirms there.
async function createCheckoutUrl(
  caller: BillingCaller,
  params: Omit<
    Parameters<typeof autumn.billing.attach>[0],
    "customerId" | "redirectMode"
  >,
) {
  requireOrgPermission(caller, { billing: ["manage"] });
  const { paymentUrl } = await autumn.billing.attach({
    ...params,
    customerId: caller.organizationId,
    redirectMode: "always",
  });
  if (!paymentUrl) {
    throw new AppError("INTERNAL_ERROR", "Autumn returned no checkout link");
  }
  return paymentUrl;
}

/** Upgrade to the base plan; checkout comes back to Settings → Billing. */
export function createPlanCheckoutUrl(caller: BillingCaller, origin: string) {
  const successUrl = new URL(SETTINGS_BILLING_ROUTE, origin);
  successUrl.searchParams.set("checkout", "success");
  return createCheckoutUrl(caller, {
    planId: AUTUMN_PAID_PLAN_ID,
    successUrl: successUrl.href,
    checkoutSessionParams: AUTUMN_CHECKOUT_SESSION_PARAMS,
  });
}

/** Buy `amountUsd` of top-up credits. */
export function createTopUpCheckoutUrl(
  caller: BillingCaller,
  args: { amountUsd: number; origin: string },
) {
  return createCheckoutUrl(caller, {
    planId: AUTUMN_SEO_DATA_TOP_UP_PLAN_ID,
    successUrl: new URL(SETTINGS_BILLING_ROUTE, args.origin).href,
    checkoutSessionParams: AUTUMN_CHECKOUT_SESSION_PARAMS,
    featureQuantities: [
      {
        featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
        quantity: args.amountUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD,
      },
    ],
  });
}

/** Stripe's customer portal, coming back to Settings → Billing. */
export async function createBillingPortalUrl(
  caller: BillingCaller,
  origin: string,
) {
  requireOrgPermission(caller, { billing: ["manage"] });
  const { url } = await autumn.billing.openCustomerPortal({
    customerId: caller.organizationId,
    returnUrl: new URL(SETTINGS_BILLING_ROUTE, origin).href,
  });
  return url;
}
