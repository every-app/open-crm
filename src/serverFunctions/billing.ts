import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  getOrganizationBillingAccount,
  getOrganizationBillingUsage,
} from "@/server/billing/account";
import {
  createBillingPortalUrl,
  createPlanCheckoutUrl,
  createTopUpCheckoutUrl,
} from "@/server/billing/checkout";
import { isBillingEnabled } from "@/server/billing/hosted";
import { AppError } from "@/server/lib/errors";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { topUpSchema } from "@/types/schemas/billing";

// Settings → Billing, where usage is billed (server/billing): a deployment
// that doesn't bill has no billing to read or change.

async function requireBilling(): Promise<void> {
  if (!(await isBillingEnabled())) throw new AppError("NOT_FOUND");
}

/** The CRM's own origin, which checkout and the portal come back to. */
function origin(): string {
  return new URL(getRequest().url).origin;
}

export const getBillingAccount = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    await requireBilling();
    return getOrganizationBillingAccount(context);
  });

export const getBillingUsage = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    await requireBilling();
    return getOrganizationBillingUsage(context.organizationId);
  });

// Each returns a URL for the browser to open: Stripe or Autumn checkout, or
// the Stripe billing portal.

export const createPlanCheckout = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    await requireBilling();
    return createPlanCheckoutUrl(context, origin());
  });

export const createTopUpCheckout = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(topUpSchema)
  .handler(async ({ data, context }) => {
    await requireBilling();
    return createTopUpCheckoutUrl(context, { ...data, origin: origin() });
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    await requireBilling();
    return createBillingPortalUrl(context, origin());
  });
