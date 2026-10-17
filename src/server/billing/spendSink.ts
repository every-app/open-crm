import { AsyncLocalStorage } from "node:async_hooks";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { isBillingEnabled } from "./hosted";

// Where a paid call deep inside a tool reports what it cost (Sonar's web
// research, a Context.dev lookup), as gateway attribution says whose a call
// is: the work it runs in opens the scope. The agent's tools run inside
// their session's sink (tools/registry.ts, which CrmAgent's meter feeds),
// the minute cron's logo and photo lookups inside the lane's
// (agent/dispatch.ts).

/** One paid provider call, as its usage event names it. */
export type ProviderSpend = {
  provider: "openrouter" | "context";
  creditFeature: CreditFeature;
  operation: string;
  /** The provider's own price, before the markup. */
  costUsd: number;
};

export type SpendSink = (spend: ProviderSpend) => void;

const sinks = new AsyncLocalStorage<SpendSink>();

/** Runs `fn` with the paid calls made inside it reporting to `sink`. */
export function withSpendSink<T>(sink: SpendSink, fn: () => T): T {
  return sinks.run(sink, fn);
}

/** A paid call's cost, for whoever bills the work it ran in. */
export function reportSpend(spend: ProviderSpend): void {
  if (spend.costUsd <= 0) return;
  const sink = sinks.getStore();
  if (sink) {
    sink(spend);
    return;
  }
  // Every paid path runs inside a sink: one outside is spend nobody bills.
  void isBillingEnabled().then((billed) => {
    if (billed) console.error("[billing] unmetered provider spend", spend);
  });
}
