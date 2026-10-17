import { queryOptions, useQuery } from "@tanstack/react-query";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { LOW_CREDITS_THRESHOLD_USD } from "@/shared/billing";
import { getBillingAccount, getBillingUsage } from "@/serverFunctions/billing";

// Hosted billing (server/billing): read only where this deployment bills.

/** The organization's plan and credits: every billing surface reads this. */
export const billingAccountQueryOptions = () =>
  queryOptions({
    queryKey: ["billing", "account"],
    queryFn: () => getBillingAccount(),
    // Balances move with every paid call.
    staleTime: 60_000,
    // The SDK doesn't retry Autumn errors on this read (it fails open and the
    // server turns that into an error), so try once more here.
    retry: 1,
  });

/** The last 30 days of usage, by feature. */
export const billingUsageQueryOptions = () =>
  queryOptions({
    queryKey: ["billing", "usage"],
    queryFn: () => getBillingUsage(),
    staleTime: 60_000,
  });

/** Whether this deployment bills usage (Settings → Billing, the banner). */
export function useBillingEnabled(): boolean {
  return useQuery(workspaceQueryOptions()).data?.billing ?? false;
}

/** Whether the viewer may change the plan and buy credits: the owner. */
export function useCanManageBilling(): boolean {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  return workspace
    ? hasOrgPermission(workspace.role, { billing: ["manage"] })
    : false;
}

type BillingAccount = Awaited<ReturnType<typeof getBillingAccount>>;

/** The organization's plan and remaining credits in USD (OpenSEO's). */
export function creditBalance(account: BillingAccount | undefined) {
  const monthlyRemaining = account?.monthlyRemainingUsd ?? 0;
  const topUpRemaining = account?.topUpRemainingUsd ?? 0;
  const totalRemaining = monthlyRemaining + topUpRemaining;
  const isOutOfCredits = totalRemaining <= 0;
  return {
    isFreePlan: account?.planStatus !== "paid",
    monthlyRemaining,
    topUpRemaining,
    isOutOfCredits,
    isLowCredits: !isOutOfCredits && totalRemaining < LOW_CREDITS_THRESHOLD_USD,
    // When monthly credits refill, e.g. "Oct 12".
    refillDate: account?.monthlyRefillsAt
      ? new Date(account.monthlyRefillsAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : null,
  };
}

/** The account, where usage is billed, and its balance. */
export function useCreditBalance() {
  const accountQuery = useQuery({
    ...billingAccountQueryOptions(),
    enabled: useBillingEnabled(),
  });
  return { accountQuery, ...creditBalance(accountQuery.data) };
}
