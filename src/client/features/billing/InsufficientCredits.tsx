import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { SETTINGS_BILLING_ROUTE } from "@/shared/billing";
import { useCreditBalance } from "./billingQueries";
import { BASE_PLAN_OFFER } from "./plan-offers";

/**
 * OpenSEO's out-of-credits offer (its InsufficientCreditsError): a free plan
 * upgrades, a paid plan buys credits, and until the account loads the
 * generic copy points at Billing. A retry can't fix it.
 */
function useCreditsOffer() {
  const { accountQuery, isFreePlan, refillDate } = useCreditBalance();
  if (!accountQuery.data) {
    return {
      message: getStandardErrorMessage(new Error("INSUFFICIENT_CREDITS")),
      label: "Go to Billing",
    };
  }
  if (isFreePlan) {
    return {
      message: `You don't have enough credits for this. Upgrade to get $${BASE_PLAN_OFFER.monthlyCreditsUsd} of credits every month.`,
      label: "Upgrade plan",
    };
  }
  return {
    message: refillDate
      ? `You don't have enough credits for this. Buy more credits to keep going, or wait for your monthly credits to refill on ${refillDate}.`
      : "You don't have enough credits for this. Buy more credits to keep going.",
    label: "Buy credits",
  };
}

function CreditsOfferMessage() {
  return useCreditsOffer().message;
}

/** The offer's button, to Settings → Billing where each action is. */
function GetCreditsButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      // Its own text color: a red error around it would otherwise tint it.
      className="text-foreground"
      nativeButton={false}
      render={<Link to={SETTINGS_BILLING_ROUTE} />}
    >
      {useCreditsOffer().label}
    </Button>
  );
}

/** Where a refused action (Enrich now, Run now) surfaces: its toast. */
export function showInsufficientCredits() {
  toast.error(<CreditsOfferMessage />, { action: <GetCreditsButton /> });
}
