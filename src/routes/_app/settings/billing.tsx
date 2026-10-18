import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BillingSettings } from "@/client/features/billing/BillingSettings";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => pageHead("Billing"),
  // An upgrade's checkout comes back with checkout=success.
  validateSearch: z.object({
    checkout: z.literal("success").optional().catch(undefined),
  }),
  component: BillingRoute,
});

function BillingRoute() {
  const { checkout } = Route.useSearch();
  return <BillingSettings checkoutSucceeded={checkout === "success"} />;
}
