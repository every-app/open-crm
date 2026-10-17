import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { ChartColumn } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { NotFound } from "@/client/components/NotFound";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsCardFooter,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  createBillingPortalSession,
  createPlanCheckout,
  createTopUpCheckout,
  type getBillingAccount,
} from "@/serverFunctions/billing";
import { topUpFormSchema } from "@/types/schemas/billing";
import {
  billingAccountQueryOptions,
  billingUsageQueryOptions,
  creditBalance,
  useBillingEnabled,
  useCanManageBilling,
} from "./billingQueries";
import {
  BASE_PLAN_OFFER,
  getPlanName,
  monthlyCreditsFeature,
} from "./plan-offers";

type BillingAccount = Awaited<ReturnType<typeof getBillingAccount>>;

// After checkout Autumn can lag Stripe by a few seconds, so the account is
// read again every second until the plan shows, for up to this long.
const FINALIZING_TIMEOUT_MS = 30_000;

const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * Settings → Billing, where usage is billed: the plan, the credits and what
 * they went on (OpenSEO's billing page, in its words). Only the owner acts.
 */
export function BillingSettings({
  checkoutSucceeded,
}: {
  checkoutSucceeded: boolean;
}) {
  if (!useBillingEnabled()) return <NotFound />;
  return (
    <SettingsPage title="Billing">
      <Account checkoutSucceeded={checkoutSucceeded} />
      <Usage />
    </SettingsPage>
  );
}

function Account({ checkoutSucceeded }: { checkoutSucceeded: boolean }) {
  const [timedOut, setTimedOut] = useState(false);
  const account = useQuery({
    ...billingAccountQueryOptions(),
    refetchInterval: (query) =>
      checkoutSucceeded && !timedOut && query.state.data?.planStatus !== "paid"
        ? 1000
        : false,
  });
  useEffect(() => {
    if (!checkoutSucceeded) return;
    const timeout = setTimeout(() => setTimedOut(true), FINALIZING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [checkoutSucceeded]);

  return (
    <QueryState
      query={account}
      errorFallback="We couldn't load your billing details right now. Please try again."
    >
      {(data) => (
        <AccountSections
          account={data}
          finalizing={
            checkoutSucceeded && !timedOut && data.planStatus !== "paid"
          }
        />
      )}
    </QueryState>
  );
}

function AccountSections({
  account,
  finalizing,
}: {
  account: BillingAccount;
  finalizing: boolean;
}) {
  const canManage = useCanManageBilling();
  const balance = creditBalance(account);
  const { isFreePlan, isOutOfCredits, isLowCredits, refillDate } = balance;

  const status = isOutOfCredits ? (
    <span className="text-destructive">
      {isFreePlan
        ? "You’ve used your free credits. Upgrade your plan to continue."
        : `You’ve used this month’s credits. Buy more below to keep going${
            refillDate ? `, or wait for them to refill on ${refillDate}` : ""
          }.`}
    </span>
  ) : isLowCredits ? (
    <span className="text-warning-foreground dark:text-warning">
      You&rsquo;re running low on credits.{" "}
      {isFreePlan
        ? `Upgrade to get $${BASE_PLAN_OFFER.monthlyCreditsUsd}/month.`
        : "Buy more credits below."}
    </span>
  ) : null;

  return (
    <>
      <SettingsSection title="Plan">
        <SettingsCard>
          {finalizing ? (
            <SettingsRow
              label="Finalizing your subscription…"
              description="This usually takes a few seconds."
            />
          ) : (
            <SettingsRow
              label={
                account.paidPlanId
                  ? getPlanName(account.paidPlanId)
                  : "Free Plan"
              }
              description={
                account.paidPlanId
                  ? `${usd(account.monthlyCreditsUsd)} of Usage Credits each month`
                  : null
              }
            >
              {canManage && !isFreePlan ? <PortalButton /> : null}
            </SettingsRow>
          )}
          {canManage && isFreePlan && !finalizing ? (
            <SettingsRow
              label={BASE_PLAN_OFFER.name}
              description={`$${BASE_PLAN_OFFER.priceUsd}/month. ${monthlyCreditsFeature(BASE_PLAN_OFFER)}.`}
            >
              <UpgradeButton />
            </SettingsRow>
          ) : null}
          {canManage ? null : (
            <SettingsCardFooter note="Only the organization owner can change the plan or buy credits. Ask them if you need more.">
              {null}
            </SettingsCardFooter>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Credits">
        <SettingsCard>
          <SettingsRow label="Remaining" description={status}>
            <Amount
              value={usd(balance.monthlyRemaining + balance.topUpRemaining)}
            />
          </SettingsRow>
          {isFreePlan ? null : (
            <>
              <SettingsRow
                label="Monthly credits"
                description={refillDate ? `Refills on ${refillDate}.` : null}
              >
                <Amount
                  value={`${usd(balance.monthlyRemaining)} of ${usd(account.monthlyCreditsUsd)}`}
                />
              </SettingsRow>
              <SettingsRow label="Top-up credits">
                <Amount value={usd(balance.topUpRemaining)} />
              </SettingsRow>
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      {canManage && !isFreePlan ? (
        <SettingsSection
          title="Buy credits"
          description="Top-up credits never expire and are used after your monthly credits."
        >
          <TopUpForm />
        </SettingsSection>
      ) : null}
    </>
  );
}

function Amount({ value }: { value: string }) {
  return <span className="text-sm font-medium tabular-nums">{value}</span>;
}

// Each action ends by sending the browser to Stripe, so its button stays
// pending once it worked.
function UpgradeButton() {
  const checkout = useMutation({
    mutationFn: () => createPlanCheckout(),
    onSuccess: (url) => window.location.assign(url),
  });
  return (
    <Button
      pending={checkout.isPending || checkout.isSuccess}
      onClick={() => checkout.mutate()}
    >
      Upgrade Plan
    </Button>
  );
}

function PortalButton() {
  const portal = useMutation({
    mutationFn: () => createBillingPortalSession(),
    onSuccess: (url) => window.location.assign(url),
  });
  return (
    <Button
      variant="outline"
      pending={portal.isPending || portal.isSuccess}
      onClick={() => portal.mutate()}
    >
      Manage subscription
    </Button>
  );
}

function TopUpForm() {
  const checkout = useMutation({
    mutationFn: (amountUsd: number) =>
      createTopUpCheckout({ data: { amountUsd } }),
    onSuccess: (url) => window.location.assign(url),
  });
  const form = useAppForm({
    defaultValues: { amount: "20" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: topUpFormSchema },
    onSubmit: async ({ value }) => {
      await checkout.mutateAsync(Number(value.amount));
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <SettingsCard>
          <form.AppField name="amount">
            {(field) => (
              <field.RowTextField
                label="Amount"
                prefix="$"
                className="sm:w-44"
                inputMode="numeric"
                aria-label="Top-up amount in USD"
              />
            )}
          </form.AppField>
          <SettingsCardFooter>
            <form.SubmitButton disabled={checkout.isSuccess}>
              Buy credits
            </form.SubmitButton>
          </SettingsCardFooter>
        </SettingsCard>
      </form.Form>
    </form.AppForm>
  );
}

function Usage() {
  const usage = useQuery(billingUsageQueryOptions());
  return (
    <SettingsSection title="Usage by feature" description="Last 30 days">
      <QueryState query={usage} errorFallback="Failed to load usage">
        {(rows) => {
          if (rows.length === 0) {
            return (
              <EmptyState
                media="rows"
                icon={ChartColumn}
                title="No usage recorded yet"
              />
            );
          }
          const total = rows.reduce((sum, row) => sum + row.usd, 0);
          return (
            <SettingsCard>
              {rows.map((row) => (
                <SettingsRow
                  key={row.label}
                  label={row.label}
                  description={
                    <span className="mt-2 block h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(row.usd / total) * 100}%` }}
                      />
                    </span>
                  }
                >
                  <Amount value={usd(row.usd)} />
                </SettingsRow>
              ))}
            </SettingsCard>
          );
        }}
      </QueryState>
    </SettingsSection>
  );
}
