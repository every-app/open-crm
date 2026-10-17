import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { SETTINGS_BILLING_ROUTE } from "@/shared/billing";
import { useCanManageBilling, useCreditBalance } from "./billingQueries";
import { BASE_PLAN_OFFER } from "./plan-offers";

/**
 * Above every page while the workspace is out of credits or running low
 * (OpenSEO's FreePlanBanner, in its words). Nothing where usage isn't billed.
 */
export function CreditsBanner() {
  const { accountQuery, isFreePlan, isOutOfCredits, isLowCredits, refillDate } =
    useCreditBalance();
  const canManageBilling = useCanManageBilling();
  if (!accountQuery.data || (!isOutOfCredits && !isLowCredits)) return null;

  // Only the owner can change the plan or buy credits, so a link would lead
  // everyone else to a page where they can't act.
  if (!canManageBilling) {
    return (
      <Banner variant={isOutOfCredits ? "destructive" : "warning"}>
        {isOutOfCredits
          ? "Your organization has used its credits."
          : "Your organization is running low on credits."}{" "}
        Ask your organization owner to add more.
      </Banner>
    );
  }

  const creditsAction = (
    <Link
      to={SETTINGS_BILLING_ROUTE}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {isFreePlan ? "Upgrade your plan" : "Buy more credits"}
    </Link>
  );

  if (isOutOfCredits) {
    return (
      <Banner variant="destructive">
        {isFreePlan ? (
          <>
            You&rsquo;ve used your free credits. {creditsAction} to get $
            {BASE_PLAN_OFFER.monthlyCreditsUsd} of credits every month.
          </>
        ) : (
          <>
            You&rsquo;ve used this month&rsquo;s credits. {creditsAction} to
            keep going
            {refillDate ? `, or wait for them to refill on ${refillDate}` : ""}.
          </>
        )}
      </Banner>
    );
  }

  return (
    <Banner variant="warning">
      You&rsquo;re running low on credits. {creditsAction} to keep using the
      agent.
    </Banner>
  );
}

// The full-width notice strip above the page content (OpenSEO's AppBanner).
function Banner({
  variant,
  children,
}: {
  variant: "warning" | "destructive";
  children: ReactNode;
}) {
  return (
    <Alert variant={variant} banner className="shrink-0">
      <AlertDescription className="text-foreground">
        {children}
      </AlertDescription>
    </Alert>
  );
}
