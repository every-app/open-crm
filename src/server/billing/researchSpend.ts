import { isBillingEnabled } from "./hosted";
import type { ProviderSpend } from "./spendSink";
import {
  getUsageCreditsRemaining,
  trackUsageCreditSpend,
} from "./subscription";

/**
 * OpenSEO's billResearchSpend: settles admitted background work (a research
 * session, a team agent's run, the cron's logo lookups, any Context.dev call)
 * after it ran. Depletion never blocks it: what isn't covered overdraws the
 * monthly credits. Never throws. `properties` say what it was for (the
 * session or run, the task).
 */
export async function billResearchSpend(
  organizationId: string,
  spend: ProviderSpend[],
  properties: Record<string, string>,
): Promise<void> {
  const charges = spend.filter(({ costUsd }) => costUsd > 0);
  if (!charges.length) return;
  try {
    if (!(await isBillingEnabled())) return;
    // Read only to choose the credit pool, never to gate admitted work. Any
    // excess goes negative on monthly credits, which every organization has,
    // rather than disappearing against a top-up balance it may never buy.
    let { monthlyRemaining, topupRemaining } =
      await getUsageCreditsRemaining(organizationId);
    for (const { provider, creditFeature, operation, costUsd } of charges) {
      const { monthlyCredits, topupCredits } = await trackUsageCreditSpend({
        organizationId,
        creditFeature,
        costUsd,
        monthlyRemaining,
        overdraft: { topupRemaining },
        properties: { app: "open-crm", provider, operation, ...properties },
      });
      monthlyRemaining -= monthlyCredits;
      topupRemaining -= topupCredits;
    }
  } catch (error) {
    // A metering failure must not discard completed work. Do not replay an
    // uncertain charge: Autumn's track has no idempotency key.
    console.error("[billing] background credit metering failed", {
      organizationId,
      properties,
      spend: charges,
      error,
    });
  }
}
