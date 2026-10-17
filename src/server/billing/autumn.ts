import type { Autumn } from "autumn-js";
import { getEnvValueSync, getWorkersEnv } from "@/server/lib/runtime-env";

// OpenSEO's Autumn client (its src/server/billing/autumn.ts), typed to what
// the CRM reads of each answer. The SDK's client fits this shape, and so
// does local dev's stand-in (autumnDevStub.ts). Autumn is only ever called
// from the server, with the CRM's AUTUMN_SECRET_KEY.

type Balance = {
  granted: number;
  remaining: number;
  nextResetAt: number | null;
};

export type AutumnClient = {
  check(
    request: Parameters<Autumn["check"]>[0],
    options?: Parameters<Autumn["check"]>[1],
  ): Promise<{ allowed: boolean; balance: Balance | null }>;
  track(
    request: Parameters<Autumn["track"]>[0],
    options?: Parameters<Autumn["track"]>[1],
  ): Promise<unknown>;
  customers: {
    getOrCreate(
      request: Parameters<Autumn["customers"]["getOrCreate"]>[0],
    ): Promise<{
      id: string | null;
      balances: Partial<Record<string, Balance>>;
      flags: Partial<Record<string, { planId: string | null }>>;
      subscriptions: {
        planId: string;
        pastDue: boolean;
        canceledAt: number | null;
      }[];
    }>;
  };
  events: {
    aggregate(request: Parameters<Autumn["events"]["aggregate"]>[0]): Promise<{
      list: {
        groupedValues?: Partial<
          Record<string, Partial<Record<string, number>>>
        >;
      }[];
      total: Partial<Record<string, { sum: number }>>;
    }>;
  };
  billing: {
    attach(
      request: Parameters<Autumn["billing"]["attach"]>[0],
    ): Promise<{ paymentUrl: string | null }>;
    openCustomerPortal(
      request: Parameters<Autumn["billing"]["openCustomerPortal"]>[0],
    ): Promise<{ url: string }>;
  };
};

let clientPromise: Promise<AutumnClient> | undefined;

// Lazy: keeps the ~450 kB autumn-js SDK out of the eager isolate startup
// graph (a deployment that doesn't bill never loads it); resolves instantly
// after the first call.
function loadAutumn(): Promise<AutumnClient> {
  return (clientPromise ??= createClient());
}

async function createClient(): Promise<AutumnClient> {
  const env = (await getWorkersEnv()) ?? {};
  // `everyapp dev` only (no deploy carries EVERYAPP_DEV): a fixed stand-in,
  // so the hosted screens can be seen with no Autumn key.
  const stub = getEnvValueSync(env, "EVERYAPP_DEV")
    ? getEnvValueSync(env, "AUTUMN_DEV_STUB")
    : undefined;
  if (stub) return (await import("./autumnDevStub")).autumnDevStub(stub);
  const { Autumn } = await import("autumn-js");
  return new Autumn({
    secretKey: async () => {
      const key = getEnvValueSync(env, "AUTUMN_SECRET_KEY");
      if (!key) throw new Error("AUTUMN_SECRET_KEY is not set.");
      return key;
    },
    // Without this client-wide value the SDK aborts check/track after
    // 5s; a per-call timeoutMs cannot raise it. A timed-out call fails
    // open: track then never charges the usage, and check returns no
    // balance.
    timeoutMs: 10_000,
    // Retries 429/500/502/503/504 (per-operation retryCodes) plus connection
    // errors. These reads and gates sit on the request hot path, so the
    // total retry window stays short: a caller that can't gate fails fast
    // rather than holding the isolate open (OpenSEO's 2026-07-06 incident).
    retryConfig: {
      strategy: "backoff",
      backoff: {
        initialInterval: 250,
        maxInterval: 1000,
        exponent: 1.5,
        maxElapsedTime: 2500,
      },
      retryConnectionErrors: true,
    },
  });
}

/** Shape-preserving lazy facade over the client: call sites keep the plain
 *  `autumn.check(...)` form. */
export const autumn: AutumnClient = {
  check: (...args) => loadAutumn().then((client) => client.check(...args)),
  track: (...args) => loadAutumn().then((client) => client.track(...args)),
  customers: {
    getOrCreate: (...args) =>
      loadAutumn().then((client) => client.customers.getOrCreate(...args)),
  },
  events: {
    aggregate: (...args) =>
      loadAutumn().then((client) => client.events.aggregate(...args)),
  },
  billing: {
    attach: (...args) =>
      loadAutumn().then((client) => client.billing.attach(...args)),
    openCustomerPortal: (...args) =>
      loadAutumn().then((client) => client.billing.openCustomerPortal(...args)),
  },
};

// track() has no idempotency key, so replaying a deduction Autumn already
// processed (5xx after a successful write, dropped connection) would
// double-charge. Retry only 429s, which are rejected before processing.
export const AUTUMN_TRACK_RETRY_OPTIONS: Parameters<Autumn["track"]>[1] = {
  retryCodes: ["429"],
  retries: {
    strategy: "backoff",
    backoff: {
      initialInterval: 250,
      maxInterval: 2000,
      exponent: 1.5,
      maxElapsedTime: 8000,
    },
    retryConnectionErrors: false,
  },
};
